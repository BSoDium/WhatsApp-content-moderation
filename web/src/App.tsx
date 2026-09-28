import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Activity, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useControlData } from '@/lib/useControlData';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useMeta } from '@/lib/useMeta';
import { readUrlState, writeUrlState, type PanelName } from '@/lib/urlState';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ContactList } from '@/components/ContactList';
import { ContactDetailPanel, type ContactDetailPanelHandle } from '@/components/ContactDetailPanel';
import { OverviewStats } from '@/components/OverviewStats';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ActivityPanel } from '@/components/ActivityPanel';
import { PolicyEditor } from '@/components/PolicyEditor';
import { SettingsPanel } from '@/components/SettingsPanel';
import { ErrorBanner } from '@/components/ErrorBanner';
import { OpenAccessBanner } from '@/components/OpenAccessBanner';

// Matches Tailwind's `lg:` breakpoint — the width at which the list/detail
// panes split side by side instead of the detail becoming a full-screen
// overlay.
const DESKTOP_QUERY = '(min-width: 1024px)';

// Desktop list-pane sizing: wider and centered while browsing, narrower and
// flush-left once a contact is open — chosen so opening a contact both
// moves (the centering margin collapses to 0) and resizes (60% -> 50%) the
// pane at once. Centered so the two margins are equal (100 - 60) / 2 = 20.
const LIST_PANE_WIDTH_BROWSING = '60%';
const LIST_PANE_MARGIN_BROWSING = '20%';
const LIST_PANE_WIDTH_OPEN = '50%';
const LIST_PANE_MARGIN_OPEN = '0%';
const HEADER_PT_BROWSING = '5rem';
const HEADER_PT_OPEN = '1.5rem';
const HEADER_PT_MOBILE = '1rem';

// Material 3's "emphasized decelerate" curve — fast start, slow settle.
// Reads as snappier than a symmetric easeInOut despite the longer duration.
const EMPHASIZED_DECELERATE_EASE: [number, number, number, number] = [0.19, 0, 0, 1];
const MOVE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const FADE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const INSTANT_TRANSITION = { duration: 0 };

// The contact-detail pane's open/close choreography: the list pane's
// move/resize and the detail pane's slide/fade-in all animate from the
// same `panelOpen` boolean, over the same transition, so they run
// concurrently instead of staging one after the other (list moves, *then*
// detail fades in). Only meaningful at `lg:` — below that the detail pane
// is a full-screen overlay (existing translate-x behavior, untouched).
function listPaneTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { width: '100%', marginLeft: '0%' };
  return {
    width: expanded ? LIST_PANE_WIDTH_OPEN : LIST_PANE_WIDTH_BROWSING,
    marginLeft: expanded ? LIST_PANE_MARGIN_OPEN : LIST_PANE_MARGIN_BROWSING,
  };
}

// The detail pane never resizes — at `lg:` it's always the layout's fixed
// right-hand width (see its `lg:w-[50%]` className below) and only ever
// slides (`x`) and fades (`opacity`) into or out of that fixed position,
// so it arrives already at its final size instead of growing into it.
// `x` is a fraction of the pane's *own* width (Framer Motion's percentage
// transforms work the same way CSS's do), so '100%' is exactly enough to
// clear it off the right edge regardless of viewport width.
function detailPaneTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { width: '100%', opacity: 1 };
  return {
    x: expanded ? '0%' : '100%',
    opacity: expanded ? 1 : 0,
  };
}

function headerPaddingTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { paddingTop: HEADER_PT_MOBILE };
  return { paddingTop: expanded ? HEADER_PT_OPEN : HEADER_PT_BROWSING };
}

function App() {
  // Read once at mount, not on every render — the URL is the initial
  // source of truth for a fresh load/refresh, afterwards state drives the
  // URL (the effect below), not the other way around.
  const initialUrlState = useMemo(() => readUrlState(), []);
  const { contacts, roster, selectedId, setSelectedId, error, dismissError, setMonitored, runCommand, setEscalation, setContext } = useControlData(initialUrlState.contactId);
  const meta = useMeta();
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
    // Re-selecting the contact that's already open isn't a navigation —
    // without this, reflexively clicking the open contact's own row while
    // its context edit is dirty pops the unsaved-changes dialog for a
    // no-op, and a reflexive "Discard" there would wipe a live edit.
    if (nextId === selectedId) return;
    if (detailPanelRef.current?.hasUnsavedChanges()) {
      setPendingSelection(nextId);
      return;
    }
    setSelectedId(nextId);
  }

  async function confirmSaveAndContinue() {
    // Captured now, not read from state after the await: the dialog can be
    // dismissed (Escape, overlay click) while the save is in flight, which
    // would otherwise leave this closure navigating to a stale target.
    const target = pendingSelection;
    setConfirmSaving(true);
    const ok = await detailPanelRef.current?.save();
    setConfirmSaving(false);
    if (ok) {
      setSelectedId(target ?? null);
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
  // Gates focus/screen-reader reachability separately from the visual
  // animation: on desktop the detail pane only becomes interactive once its
  // open transition's onAnimationComplete fires below, so a keyboard or
  // screen-reader user can never reach it while it's still fading/resizing
  // in. Closing drops this immediately, not on a delay — only "fully open"
  // is interactive, same as before. Mobile has no such transition to wait
  // on (the full-screen overlay is a plain CSS transform), so it mirrors
  // `panelOpen` directly there.
  const [desktopDetailReady, setDesktopDetailReady] = useState(panelOpen);
  useEffect(() => {
    if (!panelOpen) setDesktopDetailReady(false);
  }, [panelOpen]);
  const detailInteractive = isDesktop ? desktopDetailReady : panelOpen;

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

  return (
    <TooltipProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
        {/*
          The detail pane below is a sibling of this flex row, not a flex
          item inside it — an absolutely positioned flex item with a
          percentage `right`/width resolves against the wrong containing
          block under Chrome once combined with this row's overflow-hidden
          (confirmed live: it rests one full pane-width further right than
          it should). Keeping it out of the flex row entirely sidesteps
          that rather than fighting it.
        */}
        <div className="flex min-h-screen">
          <motion.section
            initial={false}
            animate={listPaneTarget(isDesktop, panelOpen)}
            transition={moveTransition}
            className="flex h-screen w-full flex-col lg:min-w-[500px]"
          >
            <motion.div
              initial={false}
              animate={headerPaddingTarget(isDesktop, panelOpen)}
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
              {meta && !meta.authRequired && <OpenAccessBanner />}
              {error && <ErrorBanner error={error} onDismiss={dismissError} />}
            </motion.div>
            <div className="flex-none px-4 pb-4 lg:px-8">
              <OverviewStats />
            </div>
            <div className="min-h-0 flex-1 px-4 lg:px-8">
              <ContactList contacts={contacts} roster={roster} selectedId={selectedId} onSelect={requestSelectContact} onToggle={setMonitored} />
            </div>
          </motion.section>
        </div>

        <motion.section
          initial={false}
          animate={detailPaneTarget(isDesktop, panelOpen)}
          transition={{ x: moveTransition, opacity: fadeTransition }}
          onAnimationComplete={() => {
            if (isDesktop && panelOpen) setDesktopDetailReady(true);
          }}
          aria-label="Contact details"
          aria-hidden={!detailInteractive}
          inert={!detailInteractive}
          className={cn(
            'fixed top-0 right-0 bottom-0 left-0 h-screen bg-background transition-transform duration-[250ms] ease-in-out',
            panelOpen ? 'translate-x-0' : 'translate-x-full',
            // Taken out of the flex row entirely (absolute, not relative)
            // so its width is never part of the layout's own resize math —
            // it's always exactly half the viewport, never 0, and only
            // ever slides via the `x` motion value above. `lg:translate-x-0`
            // cancels the mobile translate-x-full/0 toggle's own CSS
            // `translate` property at desktop — left active alongside the
            // `x` motion value's `transform: translateX()`, the two stack
            // (translate and transform compose independently), doubling
            // the slide distance.
            'lg:absolute lg:left-auto lg:bottom-auto lg:w-[50%] lg:translate-x-0 lg:overflow-hidden lg:border-l lg:border-transparent lg:transition-colors lg:duration-200 lg:ease-in-out',
            detailInteractive && 'lg:border-border',
          )}
        >
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

        <AlertDialog
          open={pendingSelection !== undefined}
          onOpenChange={(open) => {
            // Ignore a dismiss attempt (Escape, overlay click) while the
            // save is in flight — closing here can't cancel the in-flight
            // request, and confirmSaveAndContinue's captured target would
            // still navigate once it resolves, contradicting the "stay"
            // the user just asked for.
            if (!open && !confirmSaving) setPendingSelection(undefined);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Unsaved moderation context</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedContact?.name ?? 'This contact'} has an unsaved moderation-context edit. Save it, discard it, or stay and keep editing.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={confirmSaving}>Stay</AlertDialogCancel>
              <Button variant="outline" onClick={confirmDiscardAndContinue} disabled={confirmSaving}>
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
