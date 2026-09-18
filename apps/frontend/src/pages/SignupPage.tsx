import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signupApi, type SignupInput } from '../api/tenants';
import type { PaymentMethod } from '../api/types';
import { ApiError } from '../api/client';
import { Button, Card, FormField, Input, Select } from '../components/ui';

const CURRENCIES = [
  { code: 'MGA', label: 'Ariary (MGA)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'USD', label: 'Dollar (USD)' },
  { code: 'XOF', label: 'Franc CFA (XOF)' },
];

const PROVIDERS: { value: PaymentMethod; label: string }[] = [
  { value: 'MVOLA', label: 'MVola' },
  { value: 'ORANGE_MONEY', label: 'Orange Money' },
  { value: 'AIRTEL_MONEY', label: 'Airtel Money' },
];

type Account = { provider: PaymentMethod; phoneNumber: string; accountName: string };

const EMPTY: SignupInput = {
  organizationName: '',
  wifiName: '',
  currency: 'MGA',
  email: '',
  password: '',
};

export function SignupPage() {
  const [form, setForm] = useState<SignupInput>(EMPTY);
  const [domains, setDomains] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([
    { provider: 'MVOLA', phoneNumber: '', accountName: '' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signupApi.signup({
        ...form,
        domains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        mobileMoneyAccounts: accounts.filter((a) => a.phoneNumber && a.accountName),
      });
      setDone(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <Card title="Inscription enregistrée">
          <p className="text-sm text-slate-700">{done}</p>
          <Link to="/login" className="mt-4 inline-block text-sm text-sky-700 hover:underline">
            Retour à la connexion
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-2xl space-y-4">
        <Card title="Créer un compte exploitant">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Nom de votre activité">
              <Input
                required
                value={form.organizationName}
                onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              />
            </FormField>
            <FormField label="Nom du Wi-Fi (vu par vos clients)">
              <Input
                required
                value={form.wifiName}
                onChange={(e) => setForm({ ...form, wifiName: e.target.value })}
              />
            </FormField>
            <FormField label="Devise">
              <Select
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Domaines (optionnel, séparés par des virgules)">
              <Input value={domains} onChange={(e) => setDomains(e.target.value)} />
            </FormField>
            <FormField label="URL du logo (optionnel)">
              <Input
                value={form.logoUrl ?? ''}
                onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              />
            </FormField>
          </div>
        </Card>

        <Card title="Vos puces Mobile Money — où vos clients enverront l'argent">
          {accounts.map((account, index) => (
            <div key={index} className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <FormField label="Opérateur">
                <Select
                  value={account.provider}
                  onChange={(e) =>
                    setAccounts(
                      accounts.map((a, i) =>
                        i === index ? { ...a, provider: e.target.value as PaymentMethod } : a,
                      ),
                    )
                  }
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Numéro de la puce">
                <Input
                  value={account.phoneNumber}
                  onChange={(e) =>
                    setAccounts(
                      accounts.map((a, i) =>
                        i === index ? { ...a, phoneNumber: e.target.value } : a,
                      ),
                    )
                  }
                />
              </FormField>
              <FormField label="Nom du titulaire">
                <Input
                  value={account.accountName}
                  onChange={(e) =>
                    setAccounts(
                      accounts.map((a, i) =>
                        i === index ? { ...a, accountName: e.target.value } : a,
                      ),
                    )
                  }
                />
              </FormField>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setAccounts([...accounts, { provider: 'MVOLA', phoneNumber: '', accountName: '' }])
            }
          >
            Ajouter une puce
          </Button>
        </Card>

        <Card title="Votre accès">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <FormField label="Email">
              <Input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </FormField>
            <FormField label="Mot de passe">
              <Input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <p className="mt-3 text-xs text-slate-500">
            Votre compte sera utilisable après validation par l'administrateur de la plateforme.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <Button type="submit" disabled={loading}>
              {loading ? 'Envoi…' : 'Créer mon compte'}
            </Button>
            <Link to="/login" className="text-sm text-slate-500 hover:underline">
              J'ai déjà un compte
            </Link>
          </div>
        </Card>
      </form>
    </div>
  );
}
