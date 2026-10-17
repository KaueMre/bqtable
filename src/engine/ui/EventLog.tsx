import type { GameEvent, LogEntry } from '@/engine/core';
import './ui.css';

const str = (v: unknown) => JSON.stringify(v);

function describe(ev: GameEvent): string {
  const e = ev as Record<string, unknown>;
  switch (ev.type) {
    case 'pieceCreated':
      return `${(e.piece as { id: string }).id} criada`;
    case 'pieceRemoved':
      return `${e.id} removida`;
    case 'pieceMoved':
      return `${e.id} ${str(e.from)} → ${str(e.to)}`;
    case 'pieceRotated':
    case 'statusChanged':
      return `${e.id}: ${str(e.from)} → ${str(e.to)}`;
    case 'attrChanged':
      return `${e.id}.${e.key}: ${str(e.from)} → ${str(e.to)}`;
    case 'globalChanged':
      return `${e.key}: ${str(e.from)} → ${str(e.to)}`;
    case 'playerAttrChanged':
      return `${e.player}.${e.key}: ${str(e.from)} → ${str(e.to)}`;
    case 'choiceRequested':
      return `pergunta: ${(e.choice as { prompt: string }).prompt}`;
    case 'choiceMade':
      return `resposta: ${str(e.value)}`;
    case 'rngAdvanced':
      return 'sorteio';
    case 'message':
      return String(e.text);
    default:
      return str(Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'type')));
  }
}

/** Texto do jogo para o log: o comando `log`, ou um evento do jogo com o campo `message`. */
function messageOf(ev: GameEvent): string | undefined {
  if (ev.type === 'message' && typeof ev.text === 'string') return ev.text;
  return typeof ev.message === 'string' ? ev.message : undefined;
}

/**
 * Log de eventos, mais recente primeiro. Recuo = nível da reação; 🔒 = bloqueia desfazer.
 *
 * Com `messages`, cada jogada que tem mensagens do jogo mostra só elas ("Ana jogou o 5 vermelho
 * → reviveu a Mermaid"); as outras jogadas mostram os eventos do motor.
 */
export function EventLog({
  log,
  limit = 40,
  isHidden,
  actorName,
  messages = false,
}: {
  log: readonly LogEntry[];
  limit?: number;
  /** Entradas que revelariam algo escondido de quem está olhando: aparecem sem detalhes. */
  isHidden?: (entry: LogEntry) => boolean;
  /** Nome do jogador que fez a jogada. */
  actorName?: (id: string) => string;
  messages?: boolean;
}) {
  const recent = log.slice(-limit);
  const actor = (entry: LogEntry) =>
    entry.actor && (
      <span className="event-log-actor">{actorName?.(entry.actor) ?? entry.actor}: </span>
    );
  const raw = (entry: LogEntry) => (
    <li key={entry.seq} style={{ paddingLeft: entry.depth * 16 }}>
      <span className="event-log-seq">{entry.seq}</span>
      {actor(entry)}
      <span className="event-log-type">{entry.event.type}</span>{' '}
      {isHidden?.(entry) ? <em>(oculto)</em> : describe(entry.event)}
      {entry.by && <span className="event-log-by"> ← {entry.by}</span>}
      {entry.event.revealsInfo && ' 🔒'}
    </li>
  );
  if (!messages) {
    return (
      <ol className="event-log" aria-label="Log de eventos">
        {[...recent].reverse().map(raw)}
      </ol>
    );
  }
  const plays: LogEntry[][] = [];
  for (const entry of recent) {
    const last = plays.at(-1);
    if (last && last[0]!.play === entry.play) last.push(entry);
    else plays.push([entry]);
  }
  return (
    <ol className="event-log" aria-label="Log de eventos">
      {plays.reverse().flatMap((play) => {
        const texts = play.filter((e) => messageOf(e.event) !== undefined && !isHidden?.(e));
        if (texts.length === 0) return [...play].reverse().map(raw);
        return [...texts].reverse().map((entry) => (
          <li key={entry.seq} className="event-log-message">
            {actor(entry)}
            {messageOf(entry.event)}
            {entry.event.revealsInfo && ' 🔒'}
          </li>
        ));
      })}
    </ol>
  );
}
