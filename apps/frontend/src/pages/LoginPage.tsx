import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { AuthNotice, AuthShell } from '../components/AuthShell';
import { Button, FormField, Input } from '../components/ui';

type Notice = { tone: 'error' | 'warning'; message: string };

/**
 * Traduit l'échec en message utile. Le serveur distingue déjà le mot de passe
 * faux (401) du compte non activé ou suspendu (403) : écraser les deux sous
 * « identifiants invalides » ferait chercher une faute de frappe à quelqu'un
 * qui n'a qu'à attendre son activation.
 */
function toNotice(error: unknown): Notice {
  if (error instanceof ApiError) {
    if (error.status === 403) return { tone: 'warning', message: error.message };
    if (error.status === 401) return { tone: 'error', message: 'Email ou mot de passe incorrect' };
    // Un 429 n'est pas une erreur d'identifiants : le serveur dit déjà
    // combien de temps attendre, et le peindre en rouge laisserait croire
    // que le mot de passe est faux alors qu'il n'a pas été vérifié.
    if (error.status === 429) return { tone: 'warning', message: error.message };
    return { tone: 'error', message: error.message };
  }
  return {
    tone: 'error',
    message: "Serveur injoignable — vérifiez que l'application est démarrée",
  };
}

export function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    const to = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={to} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate('/', { replace: true });
    } catch (error) {
      setNotice(toNotice(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Connexion" subtitle="Accédez à la console de votre réseau.">
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <FormField label="Adresse email">
          <Input
            type="email"
            uiSize="md"
            required
            autoFocus
            autoComplete="username"
            placeholder="vous@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>

        <FormField label="Mot de passe">
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              uiSize="md"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-16"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showPassword ? 'Masquer' : 'Afficher'}
            </button>
          </div>
        </FormField>

        {notice && <AuthNotice tone={notice.tone}>{notice.message}</AuthNotice>}

        <Button type="submit" uiSize="md" disabled={loading} className="w-full">
          {loading ? 'Connexion…' : 'Se connecter'}
        </Button>
      </form>

      <p className="mt-8 border-t border-slate-100 pt-6 text-center text-sm text-slate-500">
        Vous exploitez un réseau Wi-Fi ?{' '}
        <Link to="/signup" className="font-medium text-sky-700 hover:underline">
          Créer un compte
        </Link>
      </p>
    </AuthShell>
  );
}
