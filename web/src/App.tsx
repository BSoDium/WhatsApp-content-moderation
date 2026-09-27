import { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useControlData } from '@/lib/useControlData';
import { readUrlState, writeUrlState } from '@/lib/urlState';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ContactList } from '@/components/ContactList';
import { ContactDetailPanel } from '@/components/ContactDetailPanel';
import { ActivityPanel } from '@/components/ActivityPanel';
import { ErrorBanner } from '@/components/ErrorBanner';

interface ActivityRequest {
  seq: number;
  contactId: string | null;
}

function App() {
  // Read once at mount, not on every render — the URL is the initial
  // source of truth for a fresh load/refresh, afterwards state drives the
  // URL (the effect below), not the other way around.
  const initialUrlState = useMemo(() => readUrlState(), []);
  const { contacts, roster, selectedId, setSelectedId, error, dismissError, setMonitored, runCommand, setEscalation } = useControlData(initialUrlState.contactId);
  const [activityOpen, setActivityOpen] = useState(initialUrlState.activityOpen);
  const [activityRequest, setActivityRequest] = useState<ActivityRequest>({ seq: 0, contactId: initialUrlState.activityContactId });

  function openActivity(contactId: string | null = null) {
    setActivityRequest((prev) => ({ seq: prev.seq + 1, contactId }));
    setActivityOpen(true);
  }

  // Keeps the URL in sync with what's on screen so a reload (or a shared
  // link) reopens the same contact/panel instead of landing back on the
  // bare list — see lib/urlState.ts.
  useEffect(() => {
    writeUrlState({ contactId: selectedId, activityOpen, activityContactId: activityRequest.contactId });
  }, [selectedId, activityOpen, activityRequest.contactId]);

  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;
  const selectedEntry = selectedContact ? roster.find((entry) => entry.id === selectedContact.id) : undefined;
  const panelOpen = Boolean(selectedContact);
  // Width slides immediately; opacity/border-color (the divider) wait for the slide to finish before fading in — closing has no delay, only opening stages it.
  const fadeDelay = panelOpen ? '_0.25s' : '';

  return (
    <TooltipProvider>
      <div className="flex min-h-screen overflow-x-hidden bg-background text-foreground">
        <section
          className={cn(
            'flex h-screen w-full flex-col transition-[margin-left] duration-[250ms] ease-in-out lg:w-1/2 lg:min-w-[500px]',
            panelOpen ? 'lg:ml-0' : 'lg:ml-[25%]',
          )}
        >
          <div className="flex-none px-4 pt-4 pb-4 lg:px-8 lg:pt-20">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">WhatsApp moderation control</h1>
                <p className="mt-2 text-muted-foreground">Flip a switch to moderate a contact, or tap their name for detailed controls.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => openActivity(null)} className="mt-1 shrink-0">
                <Activity data-icon="inline-start" />
                Activity
              </Button>
            </div>
            {error && <ErrorBanner error={error} onDismiss={dismissError} />}
          </div>
          <div className="min-h-0 flex-1 px-4 lg:px-8">
            <ContactList contacts={contacts} roster={roster} selectedId={selectedId} onSelect={setSelectedId} onToggle={setMonitored} />
          </div>
        </section>

        <section
          className={cn(
            'fixed inset-0 h-screen bg-background transition-transform duration-[250ms] ease-in-out',
            panelOpen ? 'translate-x-0' : 'translate-x-full',
            'lg:relative lg:inset-auto lg:translate-x-0 lg:overflow-hidden lg:border-l lg:border-transparent',
            `lg:[transition:width_0.25s_ease-in-out,opacity_0.2s_ease-in-out${fadeDelay},border-color_0.2s_ease-in-out${fadeDelay}]`,
            panelOpen ? 'lg:w-1/2 lg:opacity-100 lg:border-border' : 'lg:w-0 lg:opacity-0',
          )}
          aria-label="Contact details"
        >
          <ContactDetailPanel
            key={selectedContact?.id}
            contact={selectedContact}
            entry={selectedEntry}
            onClose={() => setSelectedId(null)}
            onToggleMonitor={setMonitored}
            onRunCommand={runCommand}
            onSetEscalation={setEscalation}
            onViewHistory={(contactId) => openActivity(contactId)}
          />
        </section>

        <ActivityPanel key={activityRequest.seq} open={activityOpen} onOpenChange={setActivityOpen} initialContactId={activityRequest.contactId} contacts={contacts} />
      </div>
    </TooltipProvider>
  );
}

export default App;
