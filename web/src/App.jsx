import { cn } from '@/lib/utils';
import { useControlData } from '@/lib/useControlData';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ContactList } from '@/components/ContactList';
import { ContactDetailPanel } from '@/components/ContactDetailPanel';
import { ErrorBanner } from '@/components/ErrorBanner';

function App() {
  const { contacts, roster, selectedId, setSelectedId, error, setMonitored, runCommand, setEscalation } = useControlData();

  const selectedContact = contacts.find((contact) => contact.id === selectedId) ?? null;
  const selectedEntry = selectedContact ? roster.find((entry) => entry.id === selectedContact.id) : undefined;
  const panelOpen = Boolean(selectedContact);

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
            <h1 className="text-2xl font-semibold">WhatsApp moderation control</h1>
            <p className="mt-2 text-muted-foreground">Flip a switch to moderate a contact, or tap their name for detailed controls.</p>
            {error && <ErrorBanner error={error} onDismiss={() => {}} />}
          </div>
          <div className="min-h-0 flex-1 px-4 pb-8 lg:px-8">
            <ContactList contacts={contacts} roster={roster} selectedId={selectedId} onSelect={setSelectedId} onToggle={setMonitored} />
          </div>
        </section>

        <section
          className={cn(
            'fixed inset-0 h-screen bg-background transition-transform duration-[250ms] ease-in-out',
            panelOpen ? 'translate-x-0' : 'translate-x-full',
            'lg:relative lg:inset-auto lg:translate-x-0 lg:overflow-hidden lg:border-l lg:border-transparent',
            // Width slides immediately; opacity/border-color (the divider)
            // wait for the slide to finish before fading in — two different
            // delays on one element, which Tailwind's duration/delay utilities
            // can't express (they apply to every listed property alike), so
            // this is a raw arbitrary `transition` shorthand instead. Closing
            // has no delay (both fade and collapse together) since only the
            // *open* state below opts into staggering it.
            panelOpen
              ? 'lg:w-1/2 lg:opacity-100 lg:border-border lg:[transition:width_0.25s_ease-in-out,opacity_0.2s_ease-in-out_0.25s,border-color_0.2s_ease-in-out_0.25s]'
              : 'lg:w-0 lg:opacity-0 lg:[transition:width_0.25s_ease-in-out,opacity_0.2s_ease-in-out,border-color_0.2s_ease-in-out]',
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
          />
        </section>
      </div>
    </TooltipProvider>
  );
}

export default App;
