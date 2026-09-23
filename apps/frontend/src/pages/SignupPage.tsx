import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { signupApi, type SignupInput } from '../api/tenants';
import type { PaymentMethod } from '../api/types';
import { ApiError } from '../api/client';
import { CURRENCIES, PROVIDERS } from '../lib/options';
import { AuthNotice, AuthShell } from '../components/AuthShell';
import { BrandMark } from '../components/Brand';
import { Button, FormField, Input, Select } from '../components/ui';

/** Doit rester aligné sur MIN_PASSWORD_LENGTH côté serveur (auth.service.ts). */
const MIN_PASSWORD_LENGTH = 6;

type Account = { provider: PaymentMethod; phoneNumber: string; accountName: string };

const STEPS = [
  { title: 'Votre activité', hint: 'Ce que vos clients verront' },
  { title: 'Mobile Money', hint: 'Où vos clients paient' },
  { title: 'Votre accès', hint: 'Vos identifiants de connexion' },
];

const EMPTY_FORM: SignupInput = {
  organizationName: '',
  wifiName: '',
  currency: 'MGA',
  email: '',
  password: '',
};

const EMPTY_ACCOUNT: Account = { provider: 'MVOLA', phoneNumber: '', accountName: '' };

export function SignupPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<SignupInput>(EMPTY_FORM);
  const [domains, setDomains] = useState('');
  const [accounts, setAccounts] = useState<Account[]>([EMPTY_ACCOUNT]);
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function patchAccount(index: number, patch: Partial<Account>) {
    setAccounts(accounts.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  /** Ce qui manque à l'étape courante, ou `null` si elle est complète. */
  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!form.organizationName.trim()) return 'Indiquez le nom de votre activité';
      if (!form.wifiName.trim()) return 'Indiquez le nom du Wi-Fi vu par vos clients';
      return null;
    }
    if (index === 1) {
      // Une puce à moitié saisie ne servirait à rien au client qui paie.
      const partial = accounts.find(
        (a) => (a.phoneNumber.trim() || a.accountName.trim()) && !(a.phoneNumber.trim() && a.accountName.trim()),
      );
      if (partial) return 'Chaque puce demande un numéro et le nom de son titulaire';
      return null;
    }
    if (!form.email.trim()) return 'Indiquez votre adresse email';
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
    }
    if (form.password !== passwordConfirm) return 'Les deux mots de passe ne correspondent pas';
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);

    // Entrée dans un champ = étape suivante tant qu'il en reste une.
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      return;
    }

    setLoading(true);
    try {
      const result = await signupApi.signup({
        ...form,
        organizationName: form.organizationName.trim(),
        wifiName: form.wifiName.trim(),
        email: form.email.trim(),
        logoUrl: form.logoUrl?.trim() || undefined,
        domains: domains.split(',').map((d) => d.trim()).filter(Boolean),
        mobileMoneyAccounts: accounts.filter((a) => a.phoneNumber.trim() && a.accountName.trim()),
      });
      setDone(result.message);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Serveur injoignable — vérifiez que l'application est démarrée",
      );
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <BrandMark className="mx-auto h-12 w-12" />
          {/* << Inscription enregistree >> etait exact quand il fallait
              attendre une validation. Le compte s'ouvre maintenant seul :
              annoncer l'enregistrement laisserait croire qu'on attend encore. */}
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-900">
            Votre essai a commencé
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{done}</p>
          <div className="mt-6 rounded-lg bg-slate-50 px-4 py-3 text-left text-sm">
            <p className="font-medium text-slate-700">Vos identifiants</p>
            <p className="mt-1 break-all font-mono text-xs text-slate-600">{form.email.trim()}</p>
            <p className="mt-1.5 text-slate-500">À utiliser dès maintenant.</p>
          </div>
          {/* Un bouton, et non un lien discret : il n'attend plus rien, il
              n'a plus qu'a entrer. */}
          <Link
            to="/login"
            className="mt-6 inline-block rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-700"
          >
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  return (
    <AuthShell
      wide
      title="Créer un compte exploitant"
      subtitle="Trois étapes, puis validation par la plateforme."
    >
      <ol className="mb-8 grid grid-cols-3 gap-2">
        {STEPS.map((item, index) => {
          const state = index === step ? 'current' : index < step ? 'done' : 'todo';
          return (
            <li key={item.title}>
              <div
                className={`h-1 rounded-full ${
                  state === 'todo' ? 'bg-slate-200' : 'bg-sky-600'
                }`}
              />
              <p
                className={`mt-2 text-xs font-medium ${
                  state === 'current' ? 'text-sky-700' : 'text-slate-500'
                }`}
              >
                {index + 1}. {item.title}
              </p>
              <p className="text-xs text-slate-400">{item.hint}</p>
            </li>
          );
        })}
      </ol>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        {step === 0 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <FormField label="Nom de votre activité">
              <Input
                uiSize="md"
                autoFocus
                placeholder="Zone WIFI-TATI"
                value={form.organizationName}
                onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              />
            </FormField>
            <FormField label="Nom du Wi-Fi (vu par vos clients)">
              <Input
                uiSize="md"
                placeholder="hotspot-tati"
                value={form.wifiName}
                onChange={(e) => setForm({ ...form, wifiName: e.target.value })}
              />
            </FormField>
            <FormField label="Devise de vos tarifs">
              <Select
                uiSize="md"
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
            <FormField label="Domaines du portail (optionnel)">
              <Input
                uiSize="md"
                placeholder="wifitati.net, portail.wifitati.net"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField label="URL de votre logo (optionnel)">
                <Input
                  uiSize="md"
                  type="url"
                  placeholder="https://…/logo.png"
                  value={form.logoUrl ?? ''}
                  onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
                />
              </FormField>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Ces numéros sont affichés à vos clients au moment de payer, avec le nom du
              titulaire pour qu'ils reconnaissent le bon destinataire. Vous pourrez en ajouter
              d'autres plus tard.
            </p>

            {accounts.map((account, index) => (
              <div
                key={index}
                className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-3"
              >
                <FormField label="Opérateur">
                  <Select
                    uiSize="md"
                    value={account.provider}
                    onChange={(e) =>
                      patchAccount(index, { provider: e.target.value as PaymentMethod })
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
                    uiSize="md"
                    inputMode="tel"
                    placeholder="034 00 000 00"
                    value={account.phoneNumber}
                    onChange={(e) => patchAccount(index, { phoneNumber: e.target.value })}
                  />
                </FormField>
                <FormField label="Nom du titulaire">
                  <Input
                    uiSize="md"
                    placeholder="Nom inscrit sur la puce"
                    value={account.accountName}
                    onChange={(e) => patchAccount(index, { accountName: e.target.value })}
                  />
                </FormField>
                {accounts.length > 1 && (
                  <div className="sm:col-span-3">
                    <button
                      type="button"
                      onClick={() => setAccounts(accounts.filter((_, i) => i !== index))}
                      className="text-xs font-medium text-slate-500 hover:text-red-600"
                    >
                      Retirer cette puce
                    </button>
                  </div>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="secondary"
              onClick={() => setAccounts([...accounts, { ...EMPTY_ACCOUNT }])}
            >
              Ajouter une puce
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField label="Adresse email">
                <Input
                  uiSize="md"
                  type="email"
                  autoFocus
                  autoComplete="username"
                  placeholder="vous@exemple.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </FormField>
            </div>
            <FormField label="Mot de passe">
              <Input
                uiSize="md"
                type="password"
                autoComplete="new-password"
                placeholder={`${MIN_PASSWORD_LENGTH} caractères minimum`}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </FormField>
            <FormField label="Confirmer le mot de passe">
              <Input
                uiSize="md"
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
              />
            </FormField>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Votre compte sera utilisable après validation par l'administrateur de la
              plateforme.
            </p>
          </div>
        )}

        {error && <AuthNotice tone="error">{error}</AuthNotice>}

        <div className="flex items-center gap-3 border-t border-slate-100 pt-5">
          {step > 0 && (
            <Button
              type="button"
              variant="secondary"
              uiSize="md"
              onClick={() => {
                setError(null);
                setStep(step - 1);
              }}
            >
              Retour
            </Button>
          )}
          <Button type="submit" uiSize="md" disabled={loading}>
            {step < STEPS.length - 1 ? 'Continuer' : loading ? 'Envoi…' : 'Créer mon compte'}
          </Button>
          <Link to="/login" className="ml-auto text-sm text-slate-500 hover:text-slate-700">
            J'ai déjà un compte
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
