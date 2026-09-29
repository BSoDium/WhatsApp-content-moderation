import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Activity, FileText, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useControlData } from '@/lib/useControlData';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useViewportWidth } from '@/lib/useViewportWidth';
import { detailPaneTarget, listPaneTarget } from '@/lib/paneLayout';
import { useAnimatePanes } from '@/lib/useAnimatePanes';
import { useMeta } from '@/lib/useMeta';
import { useShadowMode } from '@/lib/useShadowMode';
import { useScrollLinkedStyle } from '@/lib/useScrollLinkedStyle';
import { planPopState } from '@/lib/popStatePlan';
import { historyIndex, popUrlStateIfPrevious, readUrlState, sameUrlState, toUrlState, writeUrlState, type PanelName, type UrlState } from '@/lib/urlState';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ContactList } from '@/components/ContactList';
import { ContactDetailPanel, type ContactDetailPanelHandle } from '@/components/ContactDetailPanel';
import { OverviewStats } from '@/components/OverviewStats';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ActivityPanel } from '@/components/ActivityPanel';
import { DiagnosticsPopover } from '@/components/DiagnosticsPopover';
import { PolicyEditor } from '@/components/PolicyEditor';
import { SettingsPanel } from '@/components/SettingsPanel';
import { BannerReveal } from '@/components/BannerReveal';
import { ErrorBanner } from '@/components/ErrorBanner';
import { ShadowModeBanner } from '@/components/ShadowModeBanner';

// Matches Tailwind's `lg:` breakpoint, where list/detail split side by side.
const DESKTOP_QUERY = '(min-width: 1024px)';

const HEADER_PT_BROWSING = '5rem';
const HEADER_PT_OPEN = '1.5rem';
const HEADER_PT_MOBILE = '1rem';
const COLLAPSE_AFTER_PX = 48;
const EXPAND_BELOW_PX = 0;
// How much shorter the KPI block gets when collapsed (see StatTile's COLLAPSE styles).
const COLLAPSE_HEIGHT_DELTA_PX = 80;

// Material 3's "emphasized decelerate" curve.
const EMPHASIZED_DECELERATE_EASE: [number, number, number, number] = [0.19, 0, 0, 1];
const MOVE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const FADE_TRANSITION = { duration: 0.5, ease: EMPHASIZED_DECELERATE_EASE };
const INSTANT_TRANSITION = { duration: 0 };

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
    lastRefreshedAt,
    streamLive,
  } = useControlData(initialUrlState.contactId);
  const { meta, settled: metaSettled } = useMeta();
  const { shadowMode, settled: shadowModeSettled } = useShadowMode();
  const [openPanel, setOpenPanel] = useState<PanelName | null>(initialUrlState.openPanel);
  const [skipInitialPanelAnimation, setSkipInitialPanelAnimation] = useState(initialUrlState.openPanel !== null);
  const [activityContactId, setActivityContactId] = useState<string | null>(initialUrlState.activityContactId);
  // Bumped on every open so each Sheet remounts and a discarded draft never carries over.
  const [panelSeq, setPanelSeq] = useState({ activity: 0, policy: 0, settings: 0 });

  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;
  // Driven by the id, not the resolved contact, so a deep-linked load doesn't animate open once contacts arrive.
  const panelOpen = selectedId !== null;

  // A stale deep-link id is corrected in place: making it a back stop would trap the back button on a link that instantly undoes itself.
  const replaceNextUrlWrite = useRef(false);
  useEffect(() => {
    if (contactsLoaded && contacts.length > 0 && selectedId !== null && !selectedContact) {
      replaceNextUrlWrite.current = true;
      setSelectedId(null);
    }
  }, [contactsLoaded, contacts, selectedId, selectedContact, setSelectedId]);

  const detailPanelRef = useRef<ContactDetailPanelHandle>(null);
  // `undefined` = nothing pending; `null` or an id = the selection change awaiting the user's choice.
  const [pendingSelection, setPendingSelection] = useState<string | null | undefined>(undefined);
  const [confirmSaving, setConfirmSaving] = useState(false);
  const [displayedContact, setDisplayedContact] = useState(selectedContact);

  // Set when a back/forward navigation was undone pending the dialog, so confirming lands on the full entry (panel included) and not just its contact.
  const pendingUrlTarget = useRef<UrlState | null>(null);

  function requestSelectContact(nextId: string | null) {
    // Re-selecting the open contact isn't navigation; prompting there would let a reflexive Discard wipe a live edit.
    if (nextId === selectedId) return;
    if (detailPanelRef.current?.hasUnsavedChanges()) {
      pendingUrlTarget.current = null;
      setPendingSelection(nextId);
      return;
    }
    navigateToContact(nextId);
  }

  // Closing steps back in history when that is where the user came from, so the in-page arrow and the browser's back button behave the same.
  function navigateToContact(nextId: string | null) {
    const closingToPrevious = nextId === null && popUrlStateIfPrevious(toUrlState(null, openPanel, activityContactId));
    if (!closingToPrevious) setSelectedId(nextId);
  }

  function continueNavigation(nextId: string | null, urlTarget: UrlState | null) {
    if (urlTarget) applyUrlState(urlTarget);
    else navigateToContact(nextId);
    pendingUrlTarget.current = null;
    setPendingSelection(undefined);
  }

  async function confirmSaveAndContinue() {
    // Captured before the await: the dialog can be dismissed mid-save, which would leave a stale target.
    const target = pendingSelection;
    const urlTarget = pendingUrlTarget.current;
    setConfirmSaving(true);
    const ok = await detailPanelRef.current?.save();
    setConfirmSaving(false);
    if (ok) continueNavigation(target ?? null, urlTarget);
  }

  function confirmDiscardAndContinue() {
    detailPanelRef.current?.discard();
    continueNavigation(pendingSelection ?? null, pendingUrlTarget.current);
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
  const viewportWidth = useViewportWidth();
  const actionVariant = isDesktop ? 'ghost' : 'outline';
  const reduceMotion = useReducedMotion();
  // On desktop the detail pane is only reachable by keyboard/screen reader once its open transition completes.
  const [desktopDetailReady, setDesktopDetailReady] = useState(panelOpen);
  useEffect(() => {
    if (!panelOpen) setDesktopDetailReady(false);
  }, [panelOpen]);
  const detailInteractive = isDesktop ? desktopDetailReady : panelOpen;

  const listPaneRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  // Mobile only: the pane scrolls as a whole, and the KPI block sticks once the header has scrolled away. `--collapse` flips between 0 and 1 and the tiles' CSS transitions animate it — scrubbing it with the scroll position re-laid-out the list every frame.
  const applyCollapse = useCallback((scroller: HTMLElement) => {
    const headerHeight = headerRef.current?.offsetHeight ?? 0;
    const pastHeader = scroller.scrollTop - headerHeight;
    const collapsed = scroller.style.getPropertyValue('--collapse') === '1';
    // Collapsing shortens the pane; without this guard a short list would clamp scrollTop back under EXPAND_BELOW_PX and flip straight back.
    const roomToCollapse = scroller.scrollHeight - scroller.clientHeight - COLLAPSE_HEIGHT_DELTA_PX > headerHeight + COLLAPSE_AFTER_PX;
    if (!collapsed && pastHeader > COLLAPSE_AFTER_PX && roomToCollapse) scroller.style.setProperty('--collapse', '1');
    else if (collapsed && pastHeader < EXPAND_BELOW_PX) scroller.style.setProperty('--collapse', '0');
  }, []);
  useScrollLinkedStyle(listPaneRef, !isDesktop, applyCollapse);
  useEffect(() => {
    if (isDesktop) listPaneRef.current?.style.removeProperty('--collapse');
  }, [isDesktop]);

  function showPanel(panel: PanelName, contactId: string | null = null) {
    setSkipInitialPanelAnimation(false);
    setPanelSeq((prev) => ({ ...prev, [panel]: prev[panel] + 1 }));
    if (panel === 'activity') setActivityContactId(contactId);
    setOpenPanel(panel);
  }

  function closePanelState() {
    setSkipInitialPanelAnimation(false);
    setOpenPanel(null);
  }

  function closePanel() {
    if (!popUrlStateIfPrevious(toUrlState(selectedId, null, null))) closePanelState();
  }

  const currentUrl = toUrlState(selectedId, openPanel, activityContactId);

  function applyUrlState(target: UrlState) {
    setSelectedId(target.contactId);
    if (target.openPanel === null) {
      if (openPanel !== null) closePanelState();
    } else if (!sameUrlState(target, { ...currentUrl, contactId: target.contactId })) {
      showPanel(target.openPanel, target.activityContactId);
    }
  }

  const urlWriteCount = useRef(0);
  const lastHistoryIndex = useRef(historyIndex());
  useEffect(() => {
    const replace = urlWriteCount.current === 0 || replaceNextUrlWrite.current;
    urlWriteCount.current += 1;
    replaceNextUrlWrite.current = false;
    writeUrlState(toUrlState(selectedId, openPanel, activityContactId), replace ? 'replace' : 'push');
    lastHistoryIndex.current = historyIndex();
  }, [selectedId, openPanel, activityContactId]);

  // The browser's back/forward buttons: re-derive state from the URL the entry carries. An Effect Event, so it always sees the latest state without re-subscribing every render.
  const handlePopState = useEffectEvent(() => {
    const target = readUrlState();
    const index = historyIndex();
    const previousIndex = lastHistoryIndex.current;
    lastHistoryIndex.current = index;

    const plan = planPopState({ target, current: currentUrl, hasUnsavedDraft: Boolean(detailPanelRef.current?.hasUnsavedChanges()), previousIndex, index });
    if (plan.kind === 'ignore') return;
    if (plan.kind === 'confirm') {
      if (plan.undoDelta !== 0) window.history.go(plan.undoDelta);
      pendingUrlTarget.current = target;
      setPendingSelection(target.contactId);
      return;
    }
    applyUrlState(target);
  });
  useEffect(() => {
    const listener = () => handlePopState();
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }, []);

  const moveTransition = reduceMotion ? INSTANT_TRANSITION : MOVE_TRANSITION;
  // Pane geometry also changes on viewport resizes, which must track the window rather than lag behind it; only an open/close is worth animating.
  const paneTransition = useAnimatePanes(panelOpen, viewportWidth) ? moveTransition : INSTANT_TRANSITION;
  // Banners present with the first data are part of the settled layout; only later ones animate.
  const initialDataSettled = contactsLoaded && metaSettled && shadowModeSettled;
  const fadeTransition = reduceMotion ? INSTANT_TRANSITION : FADE_TRANSITION;

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
            ref={listPaneRef}
            initial={false}
            animate={listPaneTarget(isDesktop, panelOpen, viewportWidth)}
            transition={paneTransition}
            className="isolate flex h-screen w-full flex-col overflow-y-auto [overflow-anchor:none] lg:min-w-[500px] lg:overflow-visible"
          >
            <motion.div
              ref={headerRef}
              initial={false}
              animate={headerPaddingTarget(isDesktop, panelOpen)}
              transition={paneTransition}
              className="flex-none px-4 pb-4 lg:px-8"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
                {meta && (meta.user || !meta.authRequired) && (
                  <div className="col-start-2 row-span-2 row-start-1 flex min-w-0 self-start lg:col-start-1 lg:row-span-1 lg:mb-4 lg:self-center">
                    <DiagnosticsPopover user={meta.user} lastRefreshedAt={lastRefreshedAt} streamLive={streamLive} />
                  </div>
                )}
                <h1 className="col-start-1 row-start-1 mb-1 min-w-0 self-start text-xl leading-tight font-semibold sm:text-2xl lg:row-start-2 lg:col-span-2">WhatsApp moderation control</h1>
                <p className="col-start-1 row-start-2 self-start text-sm leading-relaxed text-muted-foreground sm:text-base lg:col-span-2 lg:row-start-3">
                  Flip a switch to moderate a contact, or tap their name for detailed controls.
                </p>
                <div className="col-span-2 row-start-3 mt-4 grid shrink-0 grid-cols-3 gap-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:mt-0 lg:mb-4 lg:flex lg:justify-end lg:gap-0.5">
                  <Button variant={actionVariant} size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('settings')}>
                    <Settings data-icon="inline-start" />
                    <span>Settings</span>
                  </Button>
                  <Button variant={actionVariant} size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('policy')}>
                    <FileText data-icon="inline-start" />
                    <span>Policy</span>
                  </Button>
                  <Button variant={actionVariant} size="lg" className="h-11 px-2 lg:h-9 lg:px-3" onClick={() => showPanel('activity')}>
                    <Activity data-icon="inline-start" />
                    <span>Activity</span>
                  </Button>
                </div>
              </div>
              <AnimatePresence initial={false}>
                {shadowMode && (
                  <BannerReveal key="shadow-mode-banner" animate={initialDataSettled}>
                    <ShadowModeBanner onOpenSettings={() => showPanel('settings')} />
                  </BannerReveal>
                )}
                {error && (
                  <BannerReveal key="error-banner" animate={initialDataSettled}>
                    <ErrorBanner error={error} onDismiss={dismissError} />
                  </BannerReveal>
                )}
              </AnimatePresence>
            </motion.div>
            <div className="flex-none px-4 lg:min-h-0 lg:flex-1 lg:px-8">
              <ContactList
                contacts={contacts}
                roster={roster}
                selectedId={selectedId}
                onSelect={requestSelectContact}
                onToggle={setMonitored}
                onViewHistory={(contactId) => showPanel('activity', contactId)}
                initialLoadComplete={initialLoadComplete}
                stickyTop={<OverviewStats />}
                isDesktop={isDesktop}
              />
            </div>
          </motion.section>
        </div>

        <motion.section
          initial={false}
          animate={detailPaneTarget(isDesktop, panelOpen, viewportWidth)}
          transition={{ x: paneTransition, width: paneTransition, opacity: fadeTransition }}
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
            if (open || confirmSaving) return;
            pendingUrlTarget.current = null;
            setPendingSelection(undefined);
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
