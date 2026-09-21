import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  publicApi,
  PublicApiError,
  type ClaimView,
  type PublicPaymentAccount,
  type PublicPlan,
} from '../../api/public';
import { BrandMark } from '../../components/Brand';
import { formatValidity, TRANSLATIONS, type Lang } from './translations';
import { identifiantDepuisNom, identifiantUtilisable } from './identifiant';

const PROVIDER_LABEL: Record<string, string> = {
  MVOLA: 'MVola',
  ORANGE_MONEY: 'Orange Money',
  AIRTEL_MONEY: 'Airtel Money',
  OTHER: 'Mobile Money',
};

type Step = 'offres' | 'paiement' | 'suivi' | 'recherche';

/** Le jeton de suivi survit à une fermeture d'onglet : le client y revient. */
const TOKEN_KEY = 'gemikrot_claim_token';

export function PublicPaymentPage() {
  const { slug = '' } = useParams();

  /**
   * La page du client reste claire, quel que soit le reglage de son telephone.
   *
   * Elle se lit **au soleil**, par quelqu'un qui n'a rien choisi et qui est
   * sur le point d'engager son argent. Le sombre y est moins lisible en
   * plein jour, et c'est la meme raison qui a fait remonter le contraste de
   * la page captive du routeur.
   *
   * Le reglage de l'exploitant est rendu en quittant la page : il a choisi le
   * sombre pour sa console, pas pour la vitrine de ses clients.
   */
  useEffect(() => {
    const racine = document.documentElement;
    const etait = racine.classList.contains('sombre');
    if (!etait) return;
    racine.classList.remove('sombre');
    racine.style.colorScheme = 'light';
    return () => {
      racine.classList.add('sombre');
      racine.style.colorScheme = 'dark';
    };
  }, []);
  const [lang, setLang] = useState<Lang>('fr');
  const t = TRANSLATIONS[lang];

  const [step, setStep] = useState<Step>('offres');
  const [plan, setPlan] = useState<PublicPlan | null>(null);
  const [account, setAccount] = useState<PublicPaymentAccount | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [claim, setClaim] = useState<ClaimView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tenant = useQuery({
    queryKey: ['public-tenant', slug],
    queryFn: () => publicApi.tenant(slug),
    retry: false,
  });

  // Le suivi est réinterrogé tant que le paiement n'est pas tranché.
  useEffect(() => {
    if (!token || step === 'recherche') return;
    let cancelled = false;

    async function poll() {
      try {
        const next = await publicApi.status(slug, token!);
        if (cancelled) return;
        setClaim(next);
        setStep('suivi');
        if (next.state === 'EN_ATTENTE') window.setTimeout(poll, 3000);
      } catch {
        // Un jeton périmé ne doit pas bloquer la page sur un écran d'erreur.
        if (!cancelled) {
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch {
            /* stockage indisponible */
          }
          setToken(null);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
    };
  }, [token, slug, step]);

  const money = new Intl.NumberFormat(lang === 'mg' ? 'mg-MG' : 'fr-FR', {
    style: 'currency',
    currency: tenant.data?.currency ?? 'MGA',
    maximumFractionDigits: 0,
  });

  if (tenant.isLoading) {
    return <Shell lang={lang} onLang={setLang}><p className="text-slate-500">…</p></Shell>;
  }
  if (tenant.isError || !tenant.data) {
    return (
      <Shell lang={lang} onLang={setLang}>
        <p className="text-slate-600">Page introuvable.</p>
      </Shell>
    );
  }

  const data = tenant.data;

  return (
    <Shell
      lang={lang}
      onLang={setLang}
      wifiName={data.wifiName}
      logoUrl={data.logoUrl}
      whatsapp={data.supportWhatsapp}
      footer={
        <button
          onClick={() => {
            setStep('recherche');
            setError(null);
          }}
          className="text-sm font-medium text-sky-700 hover:underline"
        >
          {t.alreadyPaid}
        </button>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'offres' && (
        <OffersStep
          plans={data.plans}
          lang={lang}
          money={money}
          onPick={(picked) => {
            setPlan(picked);
            setAccount(data.paymentAccounts[0] ?? null);
            setStep('paiement');
            setError(null);
          }}
        />
      )}

      {step === 'paiement' && plan && (
        <PaymentStep
          slug={slug}
          lang={lang}
          plan={plan}
          money={money}
          accounts={data.paymentAccounts}
          account={account}
          onAccount={setAccount}
          onBack={() => setStep('offres')}
          onError={setError}
          onClaimed={(newToken) => {
            try {
              localStorage.setItem(TOKEN_KEY, newToken);
            } catch {
              /* stockage indisponible : le suivi vivra le temps de l'onglet */
            }
            setToken(newToken);
            setError(null);
          }}
        />
      )}

      {step === 'suivi' && claim && <ClaimStep claim={claim} lang={lang} money={money} />}

      {step === 'recherche' && (
        <LookupStep
          slug={slug}
          lang={lang}
          money={money}
          onFound={(found) => {
            setClaim(found);
            setStep('suivi');
            setError(null);
          }}
          onBack={() => setStep('offres')}
          onError={setError}
        />
      )}
    </Shell>
  );
}

// ==================== Gabarit ====================

function Shell({
  lang,
  onLang,
  wifiName,
  logoUrl,
  children,
  footer,
  whatsapp,
}: {
  lang: Lang;
  onLang: (lang: Lang) => void;
  wifiName?: string;
  logoUrl?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Numéro d'assistance, chiffres seuls. Absent, aucun lien n'est proposé. */
  whatsapp?: string | null;
}) {
  const t = TRANSLATIONS[lang];
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" />
            ) : (
              <BrandMark className="h-9 w-9" />
            )}
            <div className="text-lg font-semibold tracking-tight text-slate-900">
              {wifiName ?? 'GeMikrot'}
            </div>
          </div>

          <div className="flex overflow-hidden rounded-lg border border-slate-300">
            {(['fr', 'mg'] as const).map((value) => (
              <button
                key={value}
                onClick={() => onLang(value)}
                className={`px-2.5 py-1 text-xs font-medium ${
                  lang === value ? 'bg-sky-600 text-white' : 'bg-white text-slate-600'
                }`}
              >
                {value.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>

        {footer && <div className="mt-5 text-center">{footer}</div>}

        {/* Sur toutes les étapes, et non sur la seule page d'attente : un
            paiement qui n'aboutit pas peut se bloquer n'importe où, et
            c'est précisément là qu'on cherche quelqu'un à qui écrire.
            WhatsApp parce que c'est le canal d'ici — un numéro de
            téléphone supposerait d'appeler, ce que personne ne fait pour
            un ticket à 500 Ar. */}
        {whatsapp && (
          <div className="mt-6 text-center text-sm">
            <span className="text-slate-500">{t.needHelp}</span>{' '}
            <a
              href={`https://wa.me/${whatsapp}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-emerald-700 hover:underline"
            >
              {t.whatsapp}
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ==================== Étapes ====================

function OffersStep({
  plans,
  lang,
  money,
  onPick,
}: {
  plans: PublicPlan[];
  lang: Lang;
  money: Intl.NumberFormat;
  onPick: (plan: PublicPlan) => void;
}) {
  const t = TRANSLATIONS[lang];
  return (
    <div>
      <h1 className="text-lg font-semibold text-slate-900">{t.chooseOffer}</h1>
      <div className="mt-4 space-y-2">
        {plans.map((plan) => (
          <button
            key={plan.id}
            onClick={() => onPick(plan)}
            className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-left transition-colors hover:border-sky-400 hover:bg-sky-50/50"
          >
            <div>
              <div className="font-medium text-slate-900">{plan.name}</div>
              <div className="text-sm text-slate-500">
                {t.validity} {formatValidity(plan.validityDurationSeconds, lang)}
                {plan.maxSharedUsers && plan.maxSharedUsers > 1
                  ? ` · ${plan.maxSharedUsers} ${t.devices}`
                  : ''}
              </div>
            </div>
            <div className="shrink-0 text-base font-semibold text-sky-700">
              {money.format(Number(plan.price))}
            </div>
          </button>
        ))}
        {plans.length === 0 && <p className="text-sm text-slate-500">—</p>}
      </div>
    </div>
  );
}

function PaymentStep({
  slug,
  lang,
  plan,
  money,
  accounts,
  account,
  onAccount,
  onBack,
  onClaimed,
  onError,
}: {
  slug: string;
  lang: Lang;
  plan: PublicPlan;
  money: Intl.NumberFormat;
  accounts: PublicPaymentAccount[];
  account: PublicPaymentAccount | null;
  onAccount: (account: PublicPaymentAccount) => void;
  onBack: () => void;
  onClaimed: (token: string) => void;
  onError: (message: string) => void;
}) {
  const t = TRANSLATIONS[lang];
  const [holderName, setHolderName] = useState('');
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');
  const [copied, setCopied] = useState(false);

  // Montré pendant la saisie, pas après. Transformer le nom en silence et le
  // révéler une fois le paiement fait serait une mauvaise surprise au moment
  // précis où le client attend son accès.
  const identifiant = identifiantDepuisNom(holderName);

  const claim = useMutation({
    mutationFn: () =>
      publicApi.claim(slug, {
        planId: plan.id,
        accountId: account!.id,
        phone,
        reference,
        holderName,
      }),
    onSuccess: (result) => onClaimed(result.token),
    onError: (err) =>
      onError(err instanceof PublicApiError ? err.message : 'Erreur, réessayez.'),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    claim.mutate();
  }

  async function copyNumber() {
    if (!account) return;
    try {
      await navigator.clipboard.writeText(account.phoneNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* presse-papiers indisponible : le numéro reste lisible à l'écran */
    }
  }

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-slate-500 hover:text-slate-700">
        ← {t.back}
      </button>

      <h1 className="text-lg font-semibold text-slate-900">
        {accounts.length === 0 ? t.noAccountTitle : t.payTitle}
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {accounts.length === 0 ? t.noAccountBody : t.payIntro}
      </p>

      {accounts.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {accounts.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => onAccount(candidate)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                account?.id === candidate.id
                  ? 'border-sky-600 bg-sky-50 text-sky-700'
                  : 'border-slate-300 text-slate-600'
              }`}
            >
              {PROVIDER_LABEL[candidate.provider] ?? candidate.provider}
            </button>
          ))}
        </div>
      )}

      {account && (
        <div className="mt-4 rounded-xl bg-slate-50 p-4">
          <div className="text-xs text-slate-500">
            {PROVIDER_LABEL[account.provider] ?? account.provider}
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-3">
            <span className="font-mono text-xl font-semibold tracking-wide text-slate-900">
              {account.phoneNumber}
            </span>
            <button
              onClick={copyNumber}
              className="shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600"
            >
              {copied ? t.copied : t.copy}
            </button>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            {t.holder} : <strong>{account.accountName}</strong>
          </div>
          <div className="mt-3 border-t border-slate-200 pt-2 text-sm">
            <span className="text-slate-500">{t.amountToSend}</span>{' '}
            <span className="float-right font-semibold text-slate-900">
              {money.format(Number(plan.price))}
            </span>
          </div>
        </div>
      )}

      {/* Sans numéro à qui payer, demander de « confirmer un paiement » est
          un piège : le client n'a rien pu envoyer, et le formulaire
          l'invitait quand même à saisir une référence. Relevé en production —
          aucun compte Mobile Money n'était enregistré, et la page proposait
          malgré tout le parcours d'achat complet jusqu'à cet écran. */}
      {accounts.length === 0 ? null : (
      <form onSubmit={submit} className="mt-5 space-y-3">
        <h2 className="font-medium text-slate-900">{t.confirmTitle}</h2>
        <p className="text-sm text-slate-500">{t.confirmIntro}</p>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t.yourName}</span>
          <input
            value={holderName}
            onChange={(e) => setHolderName(e.target.value)}
            placeholder="Rakoto Jean"
            autoComplete="name"
            required
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
          <span className="mt-1 block text-xs text-slate-500">{t.yourNameHint}</span>
          {/* Le résultat, tout de suite : « Rakoto Jean » devient
              « Rakoto-Jean », et c'est cela qu'il devra taper au portail. */}
          {identifiant && (
            <span className="mt-1 block text-xs text-slate-600">
              {t.willBe} <strong className="font-mono">{identifiant}</strong>
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t.yourPhone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="034 00 000 00"
            required
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t.reference}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoCapitalize="characters"
            spellCheck={false}
            required
            placeholder="6CK4L2M9PQ"
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-base uppercase focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
          {/* L'aide du premier achat disait « elle deviendra votre mot de
              passe » -- faux pour un reabonnement, et ecrit juste sous la
              ligne qui promet le contraire. Se contredire sur l'ecran ou le
              client engage son argent est la meilleure facon de le perdre. */}
          <span className="mt-1 block text-xs text-slate-500">{t.referenceHint}</span>
        </label>

        {/* L'avertissement juste au-dessus du bouton, là où le doigt se
            pose. Plus haut, il serait lu avant d'avoir rempli quoi que ce
            soit, donc oublié au moment d'envoyer. */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="text-sm font-medium text-amber-900">⚠ {t.checkTwice}</div>
          <p className="mt-0.5 text-xs text-amber-900">{t.checkTwiceBody}</p>
        </div>

        <button
          type="submit"
          disabled={claim.isPending || !account || !identifiantUtilisable(identifiant)}
          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-sky-700 disabled:bg-slate-300"
        >
          {claim.isPending ? t.submitting : t.submit}
        </button>
      </form>
      )}
    </div>
  );
}

function ClaimStep({
  claim,
  lang,
  money,
}: {
  claim: ClaimView;
  lang: Lang;
  money: Intl.NumberFormat;
}) {
  const t = TRANSLATIONS[lang];

  if (claim.state === 'VALIDE' && claim.accessCode) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-2xl">
          ✓
        </div>
        <h1 className="mt-4 text-lg font-semibold text-slate-900">{t.doneTitle}</h1>
        {/* Un ticket imprimé n'a qu'un code, un achat en ligne en a deux :
            la phrase doit suivre, sinon elle parle d'un nom et d'une
            référence à quelqu'un qui tient un code tiré au sort. */}
        <p className="mt-1 text-sm text-slate-600">
          {claim.accessPassword ? t.doneBody : t.doneBodySingle}
        </p>
        {/* Deux champs quand l'accès en a deux, un seul quand le code
            sert des deux côtés. Montrer « identifiant » et « mot de passe »
            avec la même valeur ferait chercher une différence qui n'existe
            pas ; ne montrer qu'un champ quand ils diffèrent laisserait le
            client sans son mot de passe. */}
        <div className="mt-4 space-y-2">
          <div className="rounded-xl bg-slate-900 px-4 py-4 text-left">
            {claim.accessPassword && (
              <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                {t.loginLabel}
              </div>
            )}
            <div className="break-all text-center font-mono text-2xl font-bold tracking-[0.15em] text-white">
              {claim.accessCode}
            </div>
          </div>
          {claim.accessPassword && (
            <div className="rounded-xl bg-slate-900 px-4 py-4 text-left">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">
                {t.passwordLabel}
              </div>
              <div className="break-all text-center font-mono text-2xl font-bold tracking-[0.15em] text-white">
                {claim.accessPassword}
              </div>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {claim.accessPassword ? t.doneHint : t.doneHintSingle}
        </p>
        <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
          {claim.planName} · {money.format(Number(claim.amount))}
        </p>
      </div>
    );
  }

  if (claim.state === 'REFUSE') {
    return (
      <div className="text-center">
        <h1 className="text-lg font-semibold text-slate-900">{t.refusedTitle}</h1>
        <p className="mt-2 text-sm text-slate-600">{t.refusedBody}</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-3 border-slate-200 border-t-sky-600" />
      <h1 className="mt-4 text-lg font-semibold text-slate-900">{t.waitingTitle}</h1>
      <p className="mt-2 text-sm text-slate-600">{t.waitingBody}</p>
      <p className="mt-3 text-xs text-slate-500">{t.waitingHint}</p>
      <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500">
        {claim.planName} · {money.format(Number(claim.amount))}
      </p>
    </div>
  );
}

function LookupStep({
  slug,
  lang,
  onFound,
  onBack,
  onError,
}: {
  slug: string;
  lang: Lang;
  money: Intl.NumberFormat;
  onFound: (claim: ClaimView) => void;
  onBack: () => void;
  onError: (message: string) => void;
}) {
  const t = TRANSLATIONS[lang];
  const [phone, setPhone] = useState('');
  const [reference, setReference] = useState('');

  const lookup = useMutation({
    mutationFn: () => publicApi.lookup(slug, { phone, reference }),
    onSuccess: onFound,
    onError: (err) =>
      onError(err instanceof PublicApiError ? err.message : 'Erreur, réessayez.'),
  });

  return (
    <div>
      <button onClick={onBack} className="mb-3 text-sm text-slate-500 hover:text-slate-700">
        ← {t.back}
      </button>
      <h1 className="text-lg font-semibold text-slate-900">{t.findAccess}</h1>
      <p className="mt-1 text-sm text-slate-500">{t.findIntro}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup.mutate();
        }}
        className="mt-4 space-y-3"
      >
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t.yourPhone}</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            required
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-base focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">{t.reference}</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            autoCapitalize="characters"
            spellCheck={false}
            required
            className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-base uppercase focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </label>
        <button
          type="submit"
          disabled={lookup.isPending}
          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 font-medium text-white hover:bg-sky-700 disabled:bg-slate-300"
        >
          {lookup.isPending ? t.submitting : t.search}
        </button>
      </form>
    </div>
  );
}
