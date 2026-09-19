import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ticketTemplatesApi, type TicketTemplate } from '../api/ticket-templates';
import { vouchersApi } from '../api/vouchers';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Badge, Button, Card, FormField, Input, Select } from '../components/ui';

/**
 * L'aperçu et la feuille d'impression sont rendus dans une iframe
 * `sandbox=""` : sans `allow-scripts` ni `allow-same-origin`, rien de ce que
 * contient un modèle ne peut s'exécuter ni atteindre la session. C'est le
 * navigateur qui l'applique, indépendamment de ce que le serveur a filtré.
 */
function SandboxedSheet({ html, className = '' }: { html: string; className?: string }) {
  return (
    <iframe
      title="Aperçu des tickets"
      sandbox=""
      srcDoc={html}
      className={`w-full rounded-lg border border-slate-200 bg-white ${className}`}
    />
  );
}

export function TicketTemplatesPage() {
  const { canWrite } = useAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; html: string; perPage: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [unknown, setUnknown] = useState<string[]>([]);

  const templates = useQuery({ queryKey: ['ticket-templates'], queryFn: ticketTemplatesApi.list });
  const placeholders = useQuery({
    queryKey: ['ticket-placeholders'],
    queryFn: ticketTemplatesApi.placeholders,
  });

  const selected = useMemo<TicketTemplate | undefined>(
    () => templates.data?.find((t) => t.id === selectedId) ?? templates.data?.[0],
    [templates.data, selectedId],
  );

  useEffect(() => {
    if (selected && !draft) {
      setDraft({ name: selected.name, html: selected.html, perPage: selected.perPage });
    }
  }, [selected, draft]);

  const renderPreview = useMutation({
    mutationFn: ({ html, perPage }: { html: string; perPage: number }) =>
      ticketTemplatesApi.preview(html, perPage),
    onSuccess: (sheet) => {
      setError(null);
      setPreview(sheet.html);
      setUnknown(sheet.unknownPlaceholders);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const save = useMutation({
    mutationFn: ({ id, ...input }: { id: string; name: string; html: string; perPage: number }) =>
      ticketTemplatesApi.update(id, input),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['ticket-templates'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const create = useMutation({
    mutationFn: ticketTemplatesApi.create,
    onSuccess: (created) => {
      setError(null);
      setSelectedId(created.id);
      setDraft({ name: created.name, html: created.html, perPage: created.perPage });
      queryClient.invalidateQueries({ queryKey: ['ticket-templates'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  const remove = useMutation({
    mutationFn: ticketTemplatesApi.remove,
    onSuccess: () => {
      setError(null);
      setSelectedId(null);
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ['ticket-templates'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  function selectTemplate(id: string) {
    const template = templates.data?.find((t) => t.id === id);
    if (!template) return;
    setSelectedId(id);
    setDraft({ name: template.name, html: template.html, perPage: template.perPage });
    setPreview('');
    setUnknown([]);
    setError(null);
  }

  if (templates.isLoading || !draft) return <p className="text-slate-500">Chargement…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">Modèles de ticket</h1>
        <p className="mt-1 text-sm text-slate-500">
          Le ticket imprimé que reçoit votre client. Modifiable en HTML, avec votre logo.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <FormField label="Modèle">
          <Select
            value={selected?.id ?? ''}
            onChange={(e) => selectTemplate(e.target.value)}
            className="w-64"
          >
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} — {template.perPage}/page
              </option>
            ))}
          </Select>
        </FormField>
        {canWrite && (
          <>
            <Button
              variant="secondary"
              onClick={() =>
                create.mutate({
                  name: `Modèle ${(templates.data?.length ?? 0) + 1}`,
                  html: draft.html,
                  perPage: draft.perPage,
                })
              }
            >
              Dupliquer
            </Button>
            {selected && !selected.isDefault && (
              <Button variant="danger" onClick={() => remove.mutate(selected.id)}>
                Supprimer
              </Button>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Le modèle">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Nom">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FormField>
            <FormField label="Tickets par page A4">
              <Select
                value={draft.perPage}
                onChange={(e) => setDraft({ ...draft, perPage: Number(e.target.value) })}
              >
                <option value={30}>30 — 64 × 28 mm</option>
                <option value={20}>20 — 64 × 42 mm</option>
                <option value={10}>10 — 97 × 56 mm</option>
                <option value={4}>4 — grand format</option>
              </Select>
            </FormField>
          </div>

          <label className="mt-3 block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Contenu HTML</span>
            <textarea
              value={draft.html}
              onChange={(e) => setDraft({ ...draft, html: e.target.value })}
              spellCheck={false}
              rows={16}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </label>

          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => renderPreview.mutate({ html: draft.html, perPage: draft.perPage })}
              disabled={renderPreview.isPending}
            >
              {renderPreview.isPending ? 'Rendu…' : 'Voir l\'aperçu'}
            </Button>
            {canWrite && selected && (
              <Button
                onClick={() => save.mutate({ id: selected.id, ...draft })}
                disabled={save.isPending}
              >
                {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            )}
            {save.isSuccess && !save.isPending && (
              <span className="text-sm text-emerald-600">Enregistré</span>
            )}
          </div>
        </Card>

        <Card title="Valeurs disponibles">
          <p className="mb-3 text-xs text-slate-500">
            Écrivez-les entre doubles accolades. Une valeur inconnue reste vide et vous est
            signalée sous l'aperçu.
          </p>
          <div className="space-y-1.5">
            {placeholders.data?.map((placeholder) => (
              <div key={placeholder.name} className="flex gap-3 text-sm">
                <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-sky-700">
                  {`{{${placeholder.name}}}`}
                </code>
                <span className="text-slate-600">{placeholder.description}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
            Seule la mise en forme est acceptée : texte, images, tableaux, styles. Un script ou une
            iframe fait refuser le modèle, avec le motif — votre ticket ne part jamais amputé sans
            que vous le sachiez.
          </p>
        </Card>
      </div>

      {preview && (
        <Card title={`Aperçu — ${draft.perPage} tickets sur une page A4`}>
          {unknown.length > 0 && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Valeurs inconnues, rendues vides : {unknown.map((u) => `{{${u}}}`).join(', ')}
            </p>
          )}
          <SandboxedSheet html={preview} className="h-[500px]" />
          <p className="mt-2 text-xs text-slate-500">
            Aperçu avec des codes d'exemple. Pour imprimer de vrais tickets, passez par{' '}
            <Badge tone="slate">Tickets</Badge> puis « Imprimer ».
          </p>
        </Card>
      )}
    </div>
  );
}

/** Feuille imprimable de vrais tickets. */
export function TicketPrintPage() {
  const [templateId, setTemplateId] = useState<string>('');
  const [sheet, setSheet] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const templates = useQuery({ queryKey: ['ticket-templates'], queryFn: ticketTemplatesApi.list });
  const available = useQuery({
    queryKey: ['vouchers', 'um', 'CREATED'],
    queryFn: () => vouchersApi.list({ status: 'CREATED' }),
  });

  const render = useMutation({
    mutationFn: () => ticketTemplatesApi.render({ templateId: templateId || templates.data![0].id }),
    onSuccess: (rendered) => {
      setError(null);
      setSheet(rendered.html);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erreur inconnue'),
  });

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="text-lg font-semibold">Imprimer des tickets</h1>
        <p className="mt-1 text-sm text-slate-500">
          Seuls les tickets encore à vendre sont imprimés : réimprimer un ticket déjà vendu le
          mettrait en circulation deux fois.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 print:hidden">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <FormField label="Modèle">
          <Select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="w-64"
          >
            {templates.data?.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} — {template.perPage}/page
              </option>
            ))}
          </Select>
        </FormField>
        <Button onClick={() => render.mutate()} disabled={render.isPending || !templates.data}>
          {render.isPending ? 'Préparation…' : 'Préparer la feuille'}
        </Button>
        {sheet && (
          <Button variant="secondary" onClick={() => window.print()}>
            Imprimer
          </Button>
        )}
        <span className="text-sm text-slate-400">
          {available.data?.length ?? 0} ticket(s) à vendre
        </span>
      </div>

      {sheet && <SandboxedSheet html={sheet} className="h-[70vh] print:h-auto print:border-0" />}
    </div>
  );
}
