import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useControlData } from '@/lib/useControlData';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { readUrlState, writeUrlState, type PanelName } from '@/lib/urlState';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ContactList } from '@/components/ContactList';
import { ContactDetailPanel, type ContactDetailPanelHandle } from '@/components/ContactDetailPanel';
import { OverviewStats } from '@/components/OverviewStats';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ResizeHandle } from '@/components/ResizeHandle';
import { useResizableWidth } from '@/lib/useResizableWidth';
import { ActivityPanel } from '@/components/ActivityPanel';
import { PolicyEditor } from '@/components/PolicyEditor';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ErrorBanner } from '@/components/ErrorBanner';

// Matches Tailwind's `lg:` breakpoint — the width at which the list/detail
// panes split side by side instead of the detail becoming a full-screen
// overlay (see PanelPhase below).
const DESKTOP_QUERY = '(min-width: 1024px)';

// Desktop list-pane sizing: wider and centered while browsing, narrower and
// flush-left once a contact is open — chosen so opening a contact both
// moves (the centering margin collapses to 0) and resizes (60% -> 50%) the
// pane at once, matching the two-stage choreography below. Centered so the
// two margins are equal (100 - 60) / 2 = 20.
const LIST_PANE_WIDTH_BROWSING = '60%';
const LIST_PANE_MARGIN_BROWSING = '20%';
const LIST_PANE_WIDTH_OPEN = '50%';
const LIST_PANE_MARGIN_OPEN = '0%';
const DETAIL_PANE_WIDTH_OPEN = '50%';
const DETAIL_PANE_WIDTH_CLOSED = '0%';
const DETAIL_PANEL_MIN_WIDTH = 500;
const DETAIL_PANEL_MAX_WIDTH = 960;
const HEADER_PT_BROWSING = '5rem';
const HEADER_PT_OPEN = '1.5rem';
const HEADER_PT_MOBILE = '1rem';

const MOVE_TRANSITION = { duration: 0.25, ease: 'easeInOut' as const };
const FADE_TRANSITION = { duration: 0.2, ease: 'easeInOut' as const };
const INSTANT_TRANSITION = { duration: 0 };

// The contact-detail pane's two-stage open/close choreography:
// closed -> opening (list pane moves + resizes, detail hidden but already
// at its final width) -> open (detail fades in, no further movement) ->
// closing (detail fades out in place) -> closed (list pane moves back).
// Only meaningful at `lg:` — below that the detail pane is a full-screen
// overlay (existing translate-x behavior, untouched) and phase just
// mirrors panelOpen directly with no intermediate stages.
type PanelPhase = 'closed' | 'opening' | 'open' | 'closing';

function listPaneTarget(isDesktop: boolean, phase: PanelPhase) {
  if (!isDesktop) return { width: '100%', marginLeft: '0%' };
  const expanded = phase !== 'closed';
  return {
    width: expanded ? LIST_PANE_WIDTH_OPEN : LIST_PANE_WIDTH_BROWSING,
    marginLeft: expanded ? LIST_PANE_MARGIN_OPEN : LIST_PANE_MARGIN_BROWSING,
  };
}

function detailPaneTarget(isDesktop: boolean, phase: PanelPhase) {
  if (!isDesktop) return { width: '100%', opacity: 1 };
  return {
    width: phase === 'closed' ? DETAIL_PANE_WIDTH_CLOSED : DETAIL_PANE_WIDTH_OPEN,
    opacity: phase === 'open' ? 1 : 0,
  };
}

function headerPaddingTarget(isDesktop: boolean, phase: PanelPhase) {
  if (!isDesktop) return { paddingTop: HEADER_PT_MOBILE };
  return { paddingTop: phase === 'closed' ? HEADER_PT_BROWSING : HEADER_PT_OPEN };
}

// Seeds the resizable detail panel at roughly the same width the opening
// choreography settles on (half the viewport), so switching from the
// choreographed percentage width to the user-resizable pixel width once
// fully open doesn't visibly jump.
function estimateHalfViewportWidth(): number {
  return Math.min(DETAIL_PANEL_MAX_WIDTH, Math.max(DETAIL_PANEL_MIN_WIDTH, Math.round(window.innerWidth * 0.5)));
}

function App() {
  // Read once at mount, not on every render — the URL is the initial
  // source of truth for a fresh load/refresh, afterwards state drives the
  // URL (the effect below), not the other way around.
  const initialUrlState = useMemo(() => readUrlState(), []);
  const { contacts, roster, selectedId, setSelectedId, error, dismissError, setMonitored, runCommand, setEscalation, setContext } = useControlData(initialUrlState.contactId);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(initialUrlState.openPanel);
  const [activityContactId, setActivityContactId] = useState<string | null>(initialUrlState.activityContactId);
  // Bumped every time a panel opens (not just on the boolean flipping to
  // true) so each of the three Sheets below remounts via its `key` — a
  // discarded draft never carries over to the next time it's opened.
  const [panelSeq, setPanelSeq] = useState({ activity: 0, policy: 0, settings: 0 });

  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;
  const selectedEntry = selectedContact ? roster.find((entry) => entry.id === selectedContact.id) : undefined;
  const panelOpen = Boolean(selectedContact);

  // Guards every path that would discard the open contact-detail panel
  // (its own Back button, picking a different contact from the list) so an
  // unsaved moderation-context draft is never silently lost to a remount —
  // see ContactDetailPanel's `key={selectedContact?.id}` below.
  const detailPanelRef = useRef<ContactDetailPanelHandle>(null);
  // `undefined` = no confirmation pending; `null`/a contact id = the
  // selection change waiting on the user's save/discard/stay choice.
  const [pendingSelection, setPendingSelection] = useState<string | null | undefined>(undefined);
  const [confirmSaving, setConfirmSaving] = useState(false);

  function requestSelectContact(nextId: string | null) {
    if (detailPanelRef.current?.hasUnsavedChanges()) {
      setPendingSelection(nextId);
      return;
    }
    setSelectedId(nextId);
  }

  async function confirmSaveAndContinue() {
    setConfirmSaving(true);
    const ok = await detailPanelRef.current?.save();
    setConfirmSaving(false);
    if (ok) {
      setSelectedId(pendingSelection ?? null);
      setPendingSelection(undefined);
    }
  }

  function confirmDiscardAndContinue() {
    detailPanelRef.current?.discard();
    setSelectedId(pendingSelection ?? null);
    setPendingSelection(undefined);
  }

  // Covers the same "don't silently lose it" requirement for a tab close
  // or reload, not just in-app navigation — browsers ignore the custom
  // message and show their own generic prompt, so no string is needed.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (detailPanelRef.current?.hasUnsavedChanges()) event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<PanelPhase>(panelOpen ? 'open' : 'closed');
  // Distinguishes "the desktop/mobile breakpoint just changed" (snap
  // straight to the final state, no animation — an in-progress fade/slide
  // makes no sense to resume under a different layout mode) from "the
  // selected contact changed" (run the staged animation).
  const prevIsDesktopRef = useRef(isDesktop);

  useEffect(() => {
    const breakpointChanged = prevIsDesktopRef.current !== isDesktop;
    prevIsDesktopRef.current = isDesktop;
    if (!isDesktop || breakpointChanged || reduceMotion) {
      setPhase(panelOpen ? 'open' : 'closed');
      return;
    }
    setPhase((current) => {
      if (panelOpen && current === 'closed') return 'opening';
      if (!panelOpen && (current === 'open' || current === 'opening')) return 'closing';
      return current;
    });
  }, [panelOpen, isDesktop, reduceMotion]);

  function showPanel(panel: PanelName, contactId: string | null = null) {
    setPanelSeq((prev) => ({ ...prev, [panel]: prev[panel] + 1 }));
    if (panel === 'activity') setActivityContactId(contactId);
    setOpenPanel(panel);
  }

  function closePanel() {
    setOpenPanel(null);
  }

  // Keeps the URL in sync with what's on screen so a reload (or a shared
  // link) reopens the same contact/panel instead of landing back on the
  // bare list — see lib/urlState.ts.
  useEffect(() => {
    writeUrlState({ contactId: selectedId, openPanel, activityContactId: openPanel === 'activity' ? activityContactId : null });
  }, [selectedId, openPanel, activityContactId]);

  const moveTransition = reduceMotion ? INSTANT_TRANSITION : MOVE_TRANSITION;
  const fadeTransition = reduceMotion ? INSTANT_TRANSITION : FADE_TRANSITION;
  // Fully open only once the fade-in has actually completed — a keyboard
  // or screen-reader user must never be able to reach content that's still
  // width:50%-but-invisible mid-choreography.
  const detailInteractive = phase === 'open';

  // Only takes over from the choreographed percentage width once the panel
  // is fully open and settled — mid-animation, Motion owns the width.
  const detailResizeActive = isDesktop && phase === 'open';
  const detailWidth = useResizableWidth({
    id: 'contact-detail-panel',
    defaultWidth: estimateHalfViewportWidth(),
    min: DETAIL_PANEL_MIN_WIDTH,
    max: DETAIL_PANEL_MAX_WIDTH,
    side: 'left',
    label: 'Resize contact details panel',
  });
  const detailAnimate = detailResizeActive ? { opacity: 1 } : detailPaneTarget(isDesktop, phase);
  const detailStyle = detailResizeActive ? { width: detailWidth.width, maxWidth: 'none' } : undefined;

  return (
    <TooltipProvider>
      <div className="flex min-h-screen overflow-x-hidden bg-background text-foreground">
        <motion.section
          initial={false}
          animate={listPaneTarget(isDesktop, phase)}
          transition={moveTransition}
          onAnimationComplete={() => {
            if (isDesktop && phase === 'opening') setPhase('open');
          }}
          className="flex h-screen w-full flex-col lg:min-w-[500px]"
        >
          <motion.div
            initial={false}
            animate={headerPaddingTarget(isDesktop, phase)}
            transition={moveTransition}
            className="flex-none px-4 pb-4 lg:px-8 @container"
          >
            <div className="flex flex-col items-stretch gap-3 @lg:flex-row @lg:items-start @lg:justify-between @lg:gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold">WhatsApp moderation control</h1>
                <p className="mt-2 text-muted-foreground">Flip a switch to moderate a contact, or tap their name for detailed controls.</p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2 self-end @lg:mt-1 @lg:self-auto">
                <Button variant="outline" size="sm" onClick={() => showPanel('settings')}>
                  <Settings data-icon="inline-start" />
                  Settings
                </Button>
                <Button variant="outline" size="sm" onClick={() => showPanel('policy')}>
                  <FileText data-icon="inline-start" />
                  Policy
                </Button>
                <Button variant="outline" size="sm" onClick={() => showPanel('activity')}>
                  <Activity data-icon="inline-start" />
                  Activity
                </Button>
              </div>
            </div>
            {error && <ErrorBanner error={error} onDismiss={dismissError} />}
          </motion.div>
          <div className="flex-none px-4 pb-4 lg:px-8">
            <OverviewStats />
          </div>
          <div className="min-h-0 flex-1 px-4 lg:px-8">
            <ContactList contacts={contacts} roster={roster} selectedId={selectedId} onSelect={requestSelectContact} onToggle={setMonitored} />
          </div>
        </motion.section>

        <motion.section
          initial={false}
          animate={detailAnimate}
          style={detailStyle}
          transition={{ width: moveTransition, opacity: fadeTransition }}
          onAnimationComplete={() => {
            if (isDesktop && phase === 'closing') setPhase('closed');
          }}
          aria-label="Contact details"
          aria-hidden={!detailInteractive}
          inert={!detailInteractive}
          className={cn(
            'fixed inset-0 h-screen bg-background transition-transform duration-[250ms] ease-in-out',
            panelOpen ? 'translate-x-0' : 'translate-x-full',
            'lg:relative lg:inset-auto lg:translate-x-0 lg:overflow-hidden lg:border-l lg:border-transparent lg:transition-colors lg:duration-200 lg:ease-in-out',
            detailInteractive && 'lg:border-border',
          )}
        >
          {detailResizeActive && (
            <ResizeHandle {...detailWidth.handleProps} className="absolute inset-y-0 left-0 hidden lg:flex" />
          )}
          <ContactDetailPanel
            ref={detailPanelRef}
            key={selectedContact?.id}
            contact={selectedContact}
            entry={selectedEntry}
            onClose={() => requestSelectContact(null)}
            onToggleMonitor={setMonitored}
            onRunCommand={runCommand}
            onSetEscalation={setEscalation}
            onSetContext={setContext}
            onViewHistory={(contactId) => showPanel('activity', contactId)}
          />
        </motion.section>

        <ActivityPanel
          key={panelSeq.activity}
          open={openPanel === 'activity'}
          onOpenChange={(next) => (next ? showPanel('activity', activityContactId) : closePanel())}
          initialContactId={activityContactId}
          contacts={contacts}
        />
        <PolicyEditor key={panelSeq.policy} open={openPanel === 'policy'} onOpenChange={(next) => (next ? showPanel('policy') : closePanel())} />
        <SettingsPanel key={panelSeq.settings} open={openPanel === 'settings'} onOpenChange={(next) => (next ? showPanel('settings') : closePanel())} />

        <AlertDialog open={pendingSelection !== undefined} onOpenChange={(open) => { if (!open) setPendingSelection(undefined); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved moderation context</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedContact?.name ?? 'This contact'} has an unsaved moderation-context edit. Save it, discard it, or stay and keep editing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <Button variant="outline" onClick={confirmDiscardAndContinue}>
                Discard
              </Button>
              <Button onClick={confirmSaveAndContinue} disabled={confirmSaving} aria-busy={confirmSaving}>
                {confirmSaving ? 'Saving…' : 'Save & continue'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

export default App;
