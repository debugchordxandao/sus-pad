/**
 * Compartilhar repertório por link e backup em arquivo.
 * O link (?lista=CÓDIGO) abre o app e acrescenta o repertório à biblioteca de quem abriu.
 */

import { store } from './store.js';
import { toast } from './ui.js';

const PARAM = 'lista';

/** Cria o link de um repertório. Devolve a URL ou lança um erro com mensagem para o usuário. */
export async function createShareLink(list) {
  const resp = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ list })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'Não foi possível criar o link.');
  return `${location.origin}/?${PARAM}=${data.code}`;
}

/** Se o app foi aberto por um link de repertório, traz as músicas e limpa o endereço. */
export async function importSharedFromUrl() {
  const url = new URL(location.href);
  const code = url.searchParams.get(PARAM);
  if (!code) return;
  url.searchParams.delete(PARAM);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  try {
    const resp = await fetch(`/api/share/${encodeURIComponent(code)}`);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || 'Link inválido ou expirado.');
    const added = store.library.importList(data.list);
    if (!added) throw new Error('Limite de repertórios atingido.');
    toast(`Repertório "${added.name}" adicionado`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export function exportBackup() {
  const backup = { app: 'suspad', version: 1, exportedAt: new Date().toISOString(), library: store.library.toJSON() };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `suspad-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Lê um arquivo de backup e devolve a biblioteca nele, ou lança erro. */
export async function readBackup(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Arquivo grande demais.');
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('Este arquivo não é um backup do Sus Pad.', { cause: e }); }
  if (!data || data.app !== 'suspad' || !data.library || !Array.isArray(data.library.lists)) {
    throw new Error('Este arquivo não é um backup do Sus Pad.');
  }
  return data.library;
}
