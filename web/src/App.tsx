import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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

// Matches Tailwind's `lg:` breakpoint, where list/detail split side by side.
const DESKTOP_QUERY = '(min-width: 1024px)';

const LIST_PANE_WIDTH_BROWSING_PCT = 60;
const LIST_PANE_MARGIN_BROWSING_PCT = 20;
const LIST_PANE_WIDTH_OPEN_PCT = 50;
const LIST_PANE_MARGIN_OPEN_PCT = 0;
const LIST_PANE_WIDTH_BROWSING = `${LIST_PANE_WIDTH_BROWSING_PCT}%`;
const LIST_PANE_MARGIN_BROWSING = `${LIST_PANE_MARGIN_BROWSING_PCT}%`;
const LIST_PANE_WIDTH_OPEN = `${LIST_PANE_WIDTH_OPEN_PCT}%`;
const LIST_PANE_MARGIN_OPEN = `${LIST_PANE_MARGIN_OPEN_PCT}%`;
// Must match the detail pane's `lg:w-[50%]` class; Tailwind's static scanning can't share the literal.
const DETAIL_PANE_WIDTH_PCT = 50;
// Closed `x` (a percentage of the pane's own width) starts the detail pane's left edge at the list pane's right edge, so both edges travel the same distance.
const DETAIL_PANE_CLOSED_X = `${(((LIST_PANE_MARGIN_BROWSING_PCT + LIST_PANE_WIDTH_BROWSING_PCT) - DETAIL_PANE_WIDTH_PCT) / DETAIL_PANE_WIDTH_PCT) * 100}%`;
const HEADER_PT_BROWSING = '5rem';
const HEADER_PT_OPEN = '1.5rem';
const HEADER_PT_MOBILE = '1rem';

// Material 3's "emphasized decelerate" curve.
const EMPHASIZED_DECELERATE_EASE: [number, number, number, number] = [0.19, 0, 0, 1];
const MOVE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const FADE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const INSTANT_TRANSITION = { duration: 0 };

function listPaneTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { width: '100%', marginLeft: '0%' };
  return {
    width: expanded ? LIST_PANE_WIDTH_OPEN : LIST_PANE_WIDTH_BROWSING,
    marginLeft: expanded ? LIST_PANE_MARGIN_OPEN : LIST_PANE_MARGIN_BROWSING,
  };
}

function detailPaneTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { width: '100%', opacity: 1 };
  return {
    x: expanded ? '0%' : DETAIL_PANE_CLOSED_X,
    opacity: expanded ? 1 : 0,
  };
}

function headerPaddingTarget(isDesktop: boolean, expanded: boolean) {
  if (!isDesktop) return { paddingTop: HEADER_PT_MOBILE };
  return { paddingTop: expanded ? HEADER_PT_OPEN : HEADER_PT_BROWSING };
}

function App() {
  const initialUrlState = useMemo(() => readUrlState(), []);
  const {
    contacts,
    contactsLoaded,
    roster,
    selectedId,
    setSelectedId,
    error,
    dismissError,
    setMonitored,
    runCommand,
    setEscalation,
    setContext,
    setCallNuisanceThreshold,
    initialLoadComplete,
  } = useControlData(initialUrlState.contactId);
  const { meta, settled: metaSettled } = useMeta();
  const [openPanel, setOpenPanel] = useState<PanelName | null>(initialUrlState.openPanel);
  const [skipInitialPanelAnimation, setSkipInitialPanelAnimation] = useState(initialUrlState.openPanel !== null);
  const [activityContactId, setActivityContactId] = useState<string | null>(initialUrlState.activityContactId);
  // Bumped on every open so each Sheet remounts and a discarded draft never carries over.
  const [panelSeq, setPanelSeq] = useState({ activity: 0, policy: 0, settings: 0 });

  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;
  // Driven by the id, not the resolved contact, so a deep-linked load doesn't animate open once contacts arrive.
  const panelOpen = selectedId !== null;

  useEffect(() => {
    if (contactsLoaded && contacts.length > 0 && selectedId !== null && !selectedContact) setSelectedId(null);
  }, [contactsLoaded, contacts, selectedId, selectedContact, setSelectedId]);

  const detailPanelRef = useRef<ContactDetailPanelHandle>(null);
  // `undefined` = nothing pending; `null` or an id = the selection change awaiting the user's choice.
  const [pendingSelection, setPendingSelection] = useState<string | null | undefined>(undefined);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [displayedContact, setDisplayedContact] = useState(selectedContact);

  function requestSelectContact(nextId: string | null) {
    // Re-selecting the open contact isn't navigation; prompting there would let a reflexive Discard wipe a live edit.
    if (nextId === selectedId) return;
    if (detailPanelRef.current?.hasUnsavedChanges()) {
      setPendingSelection(nextId);
      return;
    }
    setSelectedId(nextId);
  }

  async function confirmSaveAndContinue() {
    // Captured before the await: the dialog can be dismissed mid-save, which would leave a stale target.
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

  // Browsers ignore a custom message here and show their own prompt.
  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (detailPanelRef.current?.hasUnsavedChanges()) event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const reduceMotion = useReducedMotion();
  // On desktop the detail pane is only reachable by keyboard/screen reader once its open transition completes.
  const [desktopDetailReady, setDesktopDetailReady] = useState(panelOpen);
  useEffect(() => {
    if (!panelOpen) setDesktopDetailReady(false);
  }, [panelOpen]);
  const detailInteractive = isDesktop ? desktopDetailReady : panelOpen;

  function showPanel(panel: PanelName, contactId: string | null = null) {
    setSkipInitialPanelAnimation(false);
    setPanelSeq((prev) => ({ ...prev, [panel]: prev[panel] + 1 }));
    if (panel === 'activity') setActivityContactId(contactId);
    setOpenPanel(panel);
  }

  function closePanel() {
    setSkipInitialPanelAnimation(false);
    setOpenPanel(null);
  }

  useEffect(() => {
    writeUrlState({ contactId: selectedId, openPanel, activityContactId: openPanel === 'activity' ? activityContactId : null });
  }, [selectedId, openPanel, activityContactId]);

  const moveTransition = reduceMotion ? INSTANT_TRANSITION : MOVE_TRANSITION;
  // Banners present with the first data are part of the settled layout; only later ones animate.
  const initialDataSettled = contactsLoaded && metaSettled;
  const fadeTransition = reduceMotion ? INSTANT_TRANSITION : FADE_TRANSITION;
  const bannerTransition = initialDataSettled ? fadeTransition : INSTANT_TRANSITION;

  // Keeps the last contact rendered until the close transition finishes (Framer Motion on desktop, 250ms CSS on mobile).
  useLayoutEffect(() => {
    if (selectedContact) {
      setDisplayedContact(selectedContact);
      return;
    }
    const closeMs = (isDesktop ? moveTransition.duration : 0.25) * 1000;
    const timeoutId = setTimeout(() => setDisplayedContact(null), closeMs);
    return () => clearTimeout(timeoutId);
  }, [selectedContact, isDesktop, moveTransition]);
  const displayedEntry = displayedContact ? roster.find((entry) => entry.id === displayedContact.id) : undefined;

  return (
    <TooltipProvider>
      <div className="relative min-h-screen overflow-x-hidden bg-background text-foreground">
        {/* The detail pane below is deliberately not a flex item: an absolutely positioned one with a percentage right/width resolves against the wrong containing block in Chrome under this row's overflow-hidden. */}
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
              <div className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <h1 className="min-w-0 text-xl leading-tight font-semibold sm:text-2xl lg:col-start-1 lg:row-start-1">WhatsApp moderation control</h1>
                <p className="text-sm leading-relaxed text-muted-foreground sm:text-base lg:col-span-2 lg:row-start-2 lg:truncate">Flip a switch to moderate a contact, or tap their name for detailed controls.</p>
                <div className="mt-2 grid shrink-0 grid-cols-3 gap-2 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:flex lg:justify-end lg:self-center">
                  <Button variant="outline" size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('settings')}>
                    <Settings data-icon="inline-start" />
                    Settings
                  </Button>
                  <Button variant="outline" size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('policy')}>
                    <FileText data-icon="inline-start" />
                    Policy
                  </Button>
                  <Button variant="outline" size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('activity')}>
                    <Activity data-icon="inline-start" />
                    Activity
                  </Button>
                </div>
              </div>
              <AnimatePresence initial={false}>
                {meta && !meta.authRequired && (
                  <motion.div
                    key="open-access-banner"
                    initial={{ height: 0, marginTop: 0, opacity: 0 }}
                    animate={{ height: 'auto', marginTop: '1rem', opacity: 1 }}
                    exit={{ height: 0, marginTop: 0, opacity: 0 }}
                    transition={bannerTransition}
                    className="overflow-hidden"
                  >
                    <OpenAccessBanner />
                  </motion.div>
                )}
                {error && (
                  <motion.div
                    key="error-banner"
                    initial={{ height: 0, marginTop: 0, opacity: 0 }}
                    animate={{ height: 'auto', marginTop: '1rem', opacity: 1 }}
                    exit={{ height: 0, marginTop: 0, opacity: 0 }}
                    transition={bannerTransition}
                    className="overflow-hidden"
                  >
                    <ErrorBanner error={error} onDismiss={dismissError} />
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
            <div className="flex-none px-4 pb-4 lg:px-8">
              <OverviewStats />
            </div>
            <div className="min-h-0 flex-1 px-4 lg:px-8">
              <ContactList
                contacts={contacts}
                roster={roster}
                selectedId={selectedId}
                onSelect={requestSelectContact}
                onToggle={setMonitored}
                onViewHistory={(contactId) => showPanel('activity', contactId)}
                initialLoadComplete={initialLoadComplete}
              />
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
            // `lg:translate-x-0` cancels the mobile CSS translate; alongside the `x` motion value the two compose and double the slide.
            'lg:absolute lg:left-auto lg:bottom-auto lg:w-[50%] lg:translate-x-0 lg:overflow-hidden lg:border-l lg:border-transparent lg:transition-colors lg:duration-200 lg:ease-in-out',
            detailInteractive && 'lg:border-border',
          )}
        >
          <ContactDetailPanel
            ref={detailPanelRef}
            key={displayedContact?.id}
            contact={displayedContact}
            entry={displayedEntry}
            onClose={() => requestSelectContact(null)}
            onToggleMonitor={setMonitored}
            onRunCommand={runCommand}
            onSetEscalation={setEscalation}
            onSetContext={setContext}
            onSetCallNuisanceThreshold={setCallNuisanceThreshold}
            onViewHistory={(contactId) => showPanel('activity', contactId)}
          />
        </motion.section>

        <ActivityPanel
          key={panelSeq.activity}
          open={openPanel === 'activity'}
          onOpenChange={(next) => (next ? showPanel('activity', activityContactId) : closePanel())}
          initialContactId={activityContactId}
          contacts={contacts}
          skipInitialAnimation={skipInitialPanelAnimation && initialUrlState.openPanel === 'activity'}
        />
        <PolicyEditor key={panelSeq.policy} open={openPanel === 'policy'} onOpenChange={(next) => (next ? showPanel('policy') : closePanel())} skipInitialAnimation={skipInitialPanelAnimation && initialUrlState.openPanel === 'policy'} />
        <SettingsPanel key={panelSeq.settings} open={openPanel === 'settings'} onOpenChange={(next) => (next ? showPanel('settings') : closePanel())} skipInitialAnimation={skipInitialPanelAnimation && initialUrlState.openPanel === 'settings'} />

        <AlertDialog
          open={pendingSelection !== undefined}
          onOpenChange={(open) => {
            // Dismissing mid-save can't cancel the request, and the captured target would still navigate, contradicting "Stay".
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
