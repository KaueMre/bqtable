import { useEffect, useMemo, useState } from 'react';
import { checkCombo, comboOf, type Combo, type KeyCommand } from './keys';

/** O que não dá para trocar (segurar teclas, gestos do mouse). */
const FIXED: [string, string][] = [
  ['Alt (segurar)', 'Ver a peça sob o ponteiro ampliada'],
  ['Alt, dois toques', 'Fixar o preview da peça (de novo: esconder)'],
  ['Ctrl (com o Alt)', 'No modo compacto: descrição e palavras-chave'],
  ['Esc', 'Fechar menus e popups; sair da tela cheia'],
  ['Clique', 'Selecionar uma peça'],
  ['Shift/Ctrl/Cmd + clique', 'Somar ou tirar da seleção'],
  ['Shift + arrastar no vazio', 'Selecionar com um retângulo'],
  ['Duplo clique', 'Ação da peça (virar, comprar…)'],
  ['Botão direito', 'Funções da peça (mover, girar, preview…)'],
  ['Botão do meio, arrastar', 'Mover a mesa'],
  ['Roda do mouse', 'Zoom'],
  ['Mouse parado na peça', 'Dica ao lado dela (descrição e palavras-chave)'],
];

/**
 * Lista de atalhos (como o keybinding do VS Code): busca, clique no atalho para trocar (um popup
 * espera a combinação; Enter confirma, Esc cancela), restaurar o padrão ou remover.
 */
export function KeybindingsEditor({
  commands,
  bindings,
  onChange,
  onResetAll,
}: {
  commands: readonly KeyCommand[];
  bindings: ReadonlyMap<string, Combo | null>;
  /** Novo atalho (`null` = sem atalho; `undefined` = volta ao padrão). */
  onChange: (command: string, combo: Combo | null | undefined) => void;
  onResetAll: () => void;
}) {
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<KeyCommand | null>(null);
  const q = filter.trim().toLowerCase();
  const shown = commands.filter(
    (c) =>
      !q ||
      c.label.toLowerCase().includes(q) ||
      (bindings.get(c.id) ?? '').toLowerCase().includes(q),
  );
  const groups = [...new Set(shown.map((c) => c.group))];
  return (
    <div className="bq-keys">
      <div className="bq-keys-tools">
        <input
          type="search"
          placeholder="Buscar comando ou tecla"
          aria-label="Buscar atalho"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" onClick={onResetAll}>
          Restaurar todos
        </button>
      </div>
      <table className="bq-keys-table" aria-label="Atalhos">
        <tbody>
          {groups.map((g) => [
            <tr key={`g-${g}`}>
              <th colSpan={3}>{g}</th>
            </tr>,
            ...shown
              .filter((c) => c.group === g)
              .map((c) => {
                const combo = bindings.get(c.id) ?? null;
                const changed = combo !== (c.defaultKey ?? null);
                return (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td>
                      <button
                        type="button"
                        className="bq-key"
                        aria-label={`Atalho de ${c.label}: ${combo ?? 'nenhum'}`}
                        onClick={() => setEditing(c)}
                      >
                        {combo ? <kbd>{combo}</kbd> : <span className="bq-key-none">—</span>}
                      </button>
                    </td>
                    <td className="bq-key-actions">
                      {changed && (
                        <button
                          type="button"
                          title={`Restaurar o padrão (${c.defaultKey ?? 'nenhum'})`}
                          aria-label={`Restaurar o padrão de ${c.label}`}
                          onClick={() => onChange(c.id, undefined)}
                        >
                          ↺
                        </button>
                      )}
                      {combo && (
                        <button
                          type="button"
                          title="Remover o atalho"
                          aria-label={`Remover o atalho de ${c.label}`}
                          onClick={() => onChange(c.id, null)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }),
          ])}
          <tr>
            <th colSpan={3}>Fixos (não mudam)</th>
          </tr>
          {FIXED.map(([k, v]) => (
            <tr key={k} className="bq-key-fixed">
              <td>{v}</td>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td />
            </tr>
          ))}
        </tbody>
      </table>
      {editing && (
        <KeyCapture
          command={editing}
          current={bindings.get(editing.id) ?? null}
          usedBy={(combo) => {
            const id = [...bindings].find(([cmd, c]) => c === combo && cmd !== editing.id)?.[0];
            return id ? commands.find((c) => c.id === id)?.label : undefined;
          }}
          onCancel={() => setEditing(null)}
          onConfirm={(combo) => {
            onChange(editing.id, combo);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Popup que espera a combinação: mostra o que foi apertado; Enter confirma (se a combinação não
 * estiver em uso nem reservada), Esc cancela. Enquanto aberto, as teclas não chegam ao jogo.
 */
function KeyCapture({
  command,
  current,
  usedBy,
  onCancel,
  onConfirm,
}: {
  command: KeyCommand;
  current: Combo | null;
  usedBy: (combo: Combo) => string | undefined;
  onCancel: () => void;
  onConfirm: (combo: Combo) => void;
}) {
  const [combo, setCombo] = useState<Combo | null>(null);
  const problem = useMemo(() => {
    if (!combo) return null;
    const other = usedBy(combo);
    if (other) return `Já usado por: ${other}`;
    const ok = checkCombo(combo);
    return ok === true ? null : `Não dá para usar: ${ok}`;
  }, [combo, usedBy]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // o popup fica com todas as teclas (nada chega ao jogo nem fecha as configurações)
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      const pressed = comboOf(e);
      if (pressed === 'Escape') {
        onCancel();
        return;
      }
      if (pressed === 'Enter') {
        if (combo && !problem) onConfirm(combo);
        return;
      }
      if (pressed) setCombo(pressed);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [combo, problem, onCancel, onConfirm]);
  return (
    <div className="bq-modal bq-capture" role="dialog" aria-label="Novo atalho">
      <div className="bq-modal-box">
        <strong>{command.label}</strong>
        <p className="bq-game-hint">
          Aperte a combinação de teclas e <kbd>Enter</kbd> para confirmar. <kbd>Esc</kbd> cancela.
        </p>
        <div className="bq-capture-combo" aria-live="polite">
          {combo ? <kbd>{combo}</kbd> : <span className="bq-key-none">aguardando…</span>}
        </div>
        {problem && (
          <p className="bq-capture-problem" role="alert">
            {problem}
          </p>
        )}
        {current && <p className="bq-game-hint">Atual: {current}</p>}
        <div className="bq-game-buttons">
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!combo || !!problem}
            onClick={() => combo && onConfirm(combo)}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
