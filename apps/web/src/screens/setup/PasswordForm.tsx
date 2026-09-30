import { useState, type FormEvent, type ReactNode } from 'react';
import type { KnownPrinter } from 'print-accounting-contracts';
import { api } from '../../api/endpoints.ts';
import { describeError } from '../../api/client.ts';
import { useEdit } from '../../api/queries.ts';
import { useServerName } from '../../connection/index.ts';
import { Button, Field, LinkButton, RowActions } from '../../components/index.ts';

/** The printer's administrator password, stored only in the server's credential store (Setup's step 3, and
 *  Settings). `onSaved` runs once the server confirmed it; `actions` sit beside Save (given whether it's saving). */
export function PasswordForm({ printer, onSaved, size, actions, className }: {
  printer: KnownPrinter; onSaved: () => void; size?: 'sm'; actions?: (saving: boolean) => ReactNode; className?: string;
}) {
  const [password, setPassword] = useState(''), [shown, setShown] = useState(false), [message, setMessage] = useState<string>();
  const save = useEdit((value: string) => api.savePrinterPassword(printer.id, value));
  const server = useServerName();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(undefined);
    if (!password) { setMessage("Enter the printer's administrator password."); return; }
    try { await save.mutateAsync(password); onSaved(); }
    catch (error) { setMessage(describeError(error)); }
  };
  return (
    <form onSubmit={submit} noValidate className={className ?? 'max-w-[360px]'}>
      <Field label="Administrator password" hint={`The password you use on the printer's Remote UI. It's kept in ${server}'s keychain.`} error={message}>
        {id => (
          <div className="flex items-center gap-2">
            <input id={id} type={shown ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="off" autoFocus />
            <LinkButton onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</LinkButton>
          </div>
        )}
      </Field>
      <RowActions>
        <Button type="submit" variant="primary" size={size} edit disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save password'}</Button>
        {actions?.(save.isPending)}
      </RowActions>
    </form>
  );
}
