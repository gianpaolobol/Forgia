// Upstream failures are not authentication failures of the Forgia client.
export type RoutingFailureStatus = 401 | 403 | 429 | 502 | 503 | 504;
const messages: Record<RoutingFailureStatus, string> = {
  401: 'Autenticazione del motore AI non valida: verifica le credenziali sul server.',
  403: 'Motore AI non autorizzato o gratuità non verificata.',
  429: 'Quota gratuita o riserva raggiunta: lavoro non completato.',
  502: 'Risposta del motore AI non valida o richiesta rifiutata.',
  503: 'Motore AI temporaneamente non disponibile.',
  504: 'Tempo di elaborazione del motore AI esaurito.',
};
export function knownRoutingStatus(status: unknown): status is RoutingFailureStatus {
  return typeof status === 'number' && Object.hasOwn(messages, status);
}
export function normalizeRoutingStatus(status: unknown): RoutingFailureStatus {
  if (knownRoutingStatus(status)) return status;
  if (typeof status === 'number' && status >= 500 && status <= 599) return 503;
  return 502;
}
export function summarizeRoutingFailure(statuses: readonly RoutingFailureStatus[]) {
  // Quota must never hide an observed non-quota failure.
  const priority: readonly RoutingFailureStatus[] = [401, 403, 502, 503, 504, 429];
  const status = priority.find(value => statuses.includes(value)) ?? 503;
  return {status, message: messages[status]};
}
