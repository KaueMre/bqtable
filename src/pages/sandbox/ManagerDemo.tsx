import { useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { createManager, isEvent, randomInt, type Command, type Manager } from '@/engine/core';
import { EventLog } from '@/engine/ui/EventLog';

const MAX = 5;

function createDemoManager(): Manager {
  const m = createManager({ seed: Date.now(), globals: { pontos: 0 } });
  m.registerKind({
    kind: 'aparelho',
    statuses: ['apagada', 'acesa'],
    transitions: { apagada: ['acesa'], acesa: ['apagada'] },
    attributes: z.object({ energia: z.number().int().min(0).max(MAX) }),
  });

  // Gerador → Lâmpada: copia a energia e soma 1 ponto.
  m.registerRule({
    id: 'transmitir',
    react: (ev) =>
      isEvent(ev, 'attrChanged') && ev.id === 'gerador'
        ? [
            { type: 'setAttr', id: 'lampada', key: 'energia', value: ev.to },
            { type: 'setGlobal', key: 'pontos', delta: 1 },
          ]
        : [],
  });
  // Lâmpada acende com energia >= 3.
  m.registerRule({
    id: 'acender',
    react(ev, s) {
      if (!isEvent(ev, 'attrChanged') || ev.id !== 'lampada') return [];
      const status = Number(ev.to) >= 3 ? 'acesa' : 'apagada';
      return s.pieces.lampada?.status === status
        ? []
        : [{ type: 'setStatus', id: 'lampada', status }];
    },
  });
  // Ao acender, pergunta se quer o bônus.
  m.registerRule({
    id: 'bonus',
    react: (ev) =>
      isEvent(ev, 'statusChanged') && ev.to === 'acesa'
        ? [
            {
              type: 'ask',
              rule: 'bonus',
              prompt: 'A lâmpada acendeu. Bônus?',
              options: ['+5 pontos', 'nada'],
            },
          ]
        : [],
    resolve: (_choice, value) =>
      value === '+5 pontos' ? [{ type: 'setGlobal', key: 'pontos', delta: 5 }] : [],
  });
  // Comando do jogo com sorteio: bloqueia o desfazer.
  m.registerCommand({
    type: 'sortear',
    execute(_cmd, { state, random }) {
      const g = state.pieces.gerador!;
      const to = randomInt(random, MAX + 1);
      return [
        {
          type: 'attrChanged',
          id: 'gerador',
          key: 'energia',
          from: g.attributes.energia ?? null,
          to,
        },
      ];
    },
  });

  for (const id of ['gerador', 'lampada']) {
    m.dispatch({
      type: 'createPiece',
      piece: { id, kind: 'aparelho', attributes: { energia: 0 } },
    });
  }
  m.clearHistory(); // o setup não pode ser desfeito
  return m;
}

/** Fase 2: Gestor com regras em cascata, escolha pendente, sorteio e desfazer. */
export function ManagerDemo() {
  const [manager, setManager] = useState(createDemoManager);
  const state = useSyncExternalStore(manager.subscribe, manager.getState);
  const [message, setMessage] = useState('');

  const dispatch = (cmd: Command) => {
    const r = manager.dispatch(cmd);
    setMessage(r.ok ? '' : `Recusado: ${r.error}`);
  };
  const undo = () => {
    const r = manager.undo();
    setMessage(r.ok ? '' : r.error);
  };

  const gerador = state.pieces.gerador!;
  const lampada = state.pieces.lampada!;
  const energia = Number(gerador.attributes.energia);
  const canUndo = manager.canUndo();
  const pending = state.pending;

  return (
    <div className="demo">
      <div className="demo-panel">
        <div className="demo-devices">
          <div className="demo-device">
            Gerador
            <strong>{energia}</strong>
          </div>
          <div className={`demo-device demo-device--${lampada.status}`}>
            Lâmpada ({lampada.status})<strong>{String(lampada.attributes.energia)}</strong>
          </div>
          <div className="demo-device">
            Pontos
            <strong>{String(state.globals.pontos)}</strong>
          </div>
        </div>

        {pending ? (
          <div className="demo-choice" role="group" aria-label="Escolha pendente">
            <span>{pending.prompt}</span>
            {pending.options?.map((option) => (
              <button
                key={String(option)}
                onClick={() => dispatch({ type: 'choose', choiceId: pending.id, value: option })}
              >
                {String(option)}
              </button>
            ))}
          </div>
        ) : (
          <div className="demo-buttons">
            <button
              onClick={() => dispatch({ type: 'setAttr', id: 'gerador', key: 'energia', delta: 1 })}
            >
              Energia +1
            </button>
            <button
              onClick={() =>
                dispatch({ type: 'setAttr', id: 'gerador', key: 'energia', delta: -1 })
              }
            >
              Energia −1
            </button>
            <button onClick={() => dispatch({ type: 'sortear' })}>Sortear energia</button>
          </div>
        )}
        <div className="demo-buttons">
          <button
            onClick={undo}
            disabled={canUndo !== true}
            title={canUndo === true ? '' : canUndo}
          >
            Desfazer
          </button>
          <button
            onClick={() => {
              setManager(createDemoManager());
              setMessage('');
            }}
          >
            Reiniciar
          </button>
          {canUndo !== true && <span className="demo-hint">{canUndo}</span>}
        </div>
        <p className="demo-message" role="status">
          {message}
        </p>
      </div>
      <div className="demo-panel">
        <EventLog log={state.log} />
      </div>
    </div>
  );
}
