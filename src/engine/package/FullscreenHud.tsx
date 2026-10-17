import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDispatch, useGame, useUndo, useViewer } from '@/engine/react';
import type { LoadedGame } from './game';
import { HUD_MODE_LABEL, HUD_PANELS, type HudModes, type HudPanel } from './hud';
import { KeybindingsEditor } from './Keybindings';
import type { Combo, KeyCommand } from './keys';
import { choiceLabel, choiceValue } from './manifest';

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  title,
  expanded,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** Dica; padrão: o próprio rótulo. */
  title?: string;
  expanded?: boolean;
}) {
  return (
    <button
      type="button"
      className="bq-icon-button"
      aria-label={label}
      aria-expanded={expanded}
      title={title || label}
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
    </button>
  );
}

/**
 * Barra da tela cheia, em cima à direita: desfazer, reiniciar, passar a vez, HUD (painéis),
 * configurações e sair da tela cheia.
 */
export function FullscreenBar({
  onRestart,
  passButton,
  modes,
  onCycle,
  onSettings,
  onExit,
  keyOf,
}: {
  /** Sem ele (convidado numa partida em rede), sem desfazer nem reiniciar: são do host. */
  onRestart?: () => void;
  passButton: boolean | string;
  modes: HudModes;
  onCycle: (id: HudPanel) => void;
  onSettings: () => void;
  onExit: () => void;
  /** Atalho de um comando (para a dica do botão). */
  keyOf: (command: string) => Combo | null;
}) {
  const { undo, canUndo } = useUndo();
  const dispatch = useDispatch();
  const viewer = useViewer();
  const active = useGame((s) => s.game.activePlayer);
  const passLabel = passButton === true ? 'Passar a vez' : String(passButton);
  const hint = (label: string, command: string) => {
    const combo = keyOf(command);
    return combo ? `${label} (${combo})` : label;
  };
  return (
    <div className="bq-fs-bar" role="toolbar" aria-label="Barra do jogo">
      {onRestart && (
        <IconButton
          label="Desfazer"
          icon="↶"
          onClick={() => undo()}
          disabled={canUndo !== true}
          title={canUndo === true ? hint('Desfazer', 'undo') : `Desfazer: ${canUndo}`}
        />
      )}
      {onRestart && <IconButton label="Reiniciar" icon="⟳" onClick={onRestart} />}
      {passButton !== false && (
        <IconButton
          label={passLabel}
          icon="⏭"
          onClick={() => dispatch({ type: 'nextPlayer' })}
          disabled={viewer === null || viewer !== active}
          title={hint(passLabel, 'pass')}
        />
      )}
      <HudMenu modes={modes} onCycle={onCycle} keyOf={keyOf} />
      <IconButton
        label="Configurações"
        icon="⚙"
        onClick={onSettings}
        title={hint('Configurações', 'settings')}
      />
      <IconButton
        label="Sair da tela cheia"
        icon="⤡"
        onClick={onExit}
        title={hint('Sair da tela cheia', 'fullscreen')}
      />
    </div>
  );
}

/**
 * Botão da HUD: com o mouse em cima (ou clicando), abre a lista dos painéis. Clicar num painel
 * troca o modo dele (oculto, compacto, completo); a tecla ao lado faz o mesmo.
 */
function HudMenu({
  modes,
  onCycle,
  keyOf,
}: {
  modes: HudModes;
  onCycle: (id: HudPanel) => void;
  keyOf: (command: string) => Combo | null;
}) {
  const [open, setOpen] = useState(false);
  // fecha um instante depois de o mouse sair: atravessar o vão até a lista não fecha o menu
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(closing.current), []);
  return (
    <div
      className="bq-hud-menu"
      onMouseEnter={() => {
        clearTimeout(closing.current);
        setOpen(true);
      }}
      onMouseLeave={() => {
        closing.current = setTimeout(() => setOpen(false), 200);
      }}
    >
      <IconButton label="HUD" icon="☰" onClick={() => setOpen((o) => !o)} expanded={open} />
      {open && (
        <HudToggles
          modes={modes}
          onCycle={onCycle}
          keyOf={keyOf}
          className="bq-hud-menu-list"
          label="Painéis da HUD"
        />
      )}
    </div>
  );
}

/** Os itens da HUD com o modo de cada um; clicar troca o modo (o mesmo que a tecla). */
function HudToggles({
  modes,
  onCycle,
  keyOf,
  className,
  label,
  only,
}: {
  modes: HudModes;
  onCycle: (id: HudPanel) => void;
  keyOf: (command: string) => Combo | null;
  className: string;
  label: string;
  /** Só os itens deste escopo. */
  only?: 'table';
}) {
  return (
    <ul className={className} aria-label={label}>
      {HUD_PANELS.filter((p) => !only || p.scope === only).map((p) => (
        <li key={p.id}>
          <button
            type="button"
            onClick={() => onCycle(p.id)}
            aria-label={`${p.label}: ${HUD_MODE_LABEL[modes[p.id]]}`}
          >
            <span>{p.label}</span>
            <span className={`bq-hud-mode bq-hud-mode--${modes[p.id]}`}>
              {HUD_MODE_LABEL[modes[p.id]]}
            </span>
            <kbd>{keyOf(`hud:${p.id}`) ?? '—'}</kbd>
          </button>
        </li>
      ))}
    </ul>
  );
}

type SettingsTab = 'jogo' | 'exibicao' | 'atalhos';

/** Popup de configurações: a info do jogo carregado, o que aparece na mesa e os atalhos. */
export function SettingsDialog({
  game,
  players,
  options,
  modes,
  onCycle,
  fullscreen,
  handZoom,
  onHandZoom,
  commands,
  bindings,
  onBinding,
  onResetKeys,
  onClose,
}: {
  game: LoadedGame;
  players: number;
  options?: Record<string, string>;
  modes: HudModes;
  onCycle: (id: HudPanel) => void;
  /** Na tela cheia, a aba Exibição mostra também os painéis. */
  fullscreen: boolean;
  /** Tamanho das cartas na faixa da mão (1 = 100%). */
  handZoom: number;
  onHandZoom: (zoom: number) => void;
  /** Atalhos: os comandos, o atalho de cada um, trocar um e restaurar todos. */
  commands: readonly KeyCommand[];
  bindings: ReadonlyMap<string, Combo | null>;
  onBinding: (command: string, combo: Combo | null | undefined) => void;
  onResetKeys: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<SettingsTab>('jogo');
  const keyOf = (command: string) => bindings.get(command) ?? null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const tabs: [SettingsTab, string][] = [
    ['jogo', 'Jogo'],
    ['exibicao', 'Exibição'],
    ['atalhos', 'Atalhos'],
  ];
  return (
    <div className="bq-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bq-modal-box" role="dialog" aria-label="Configurações">
        <header className="bq-modal-header">
          <div role="tablist" className="bq-tabs">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button type="button" className="bq-icon-button" aria-label="Fechar" onClick={onClose}>
            ✕
          </button>
        </header>
        <div role="tabpanel">
          {tab === 'jogo' && <GameInfo game={game} players={players} options={options} />}
          {tab === 'exibicao' && (
            <>
              <HudToggles
                modes={modes}
                onCycle={onCycle}
                keyOf={keyOf}
                className="bq-hud-toggles"
                label="Exibição"
                only={fullscreen ? undefined : 'table'}
              />
              <label className="bq-setting">
                <span>Tamanho da mão</span>
                <input
                  type="range"
                  min={50}
                  max={200}
                  step={10}
                  value={Math.round(handZoom * 100)}
                  onChange={(e) => onHandZoom(Number(e.target.value) / 100)}
                />
                <output>{Math.round(handZoom * 100)}%</output>
              </label>
            </>
          )}
          {tab === 'atalhos' && (
            <KeybindingsEditor
              commands={commands}
              bindings={bindings}
              onChange={onBinding}
              onResetAll={onResetKeys}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function GameInfo({
  game,
  players,
  options,
}: {
  game: LoadedGame;
  players: number;
  options?: Record<string, string>;
}) {
  const m = game.manifest;
  const pieces = useGame((s) => Object.keys(s.game.pieces).length);
  const rules = m.rules === undefined ? [] : [m.rules].flat();
  const rows: [string, ReactNode][] = [
    ['Nome', m.name],
    ...(m.version ? [['Versão', m.version] as [string, string]] : []),
    ...(m.author ? [['Autor', m.author] as [string, string]] : []),
    ...(m.description ? [['Descrição', m.description] as [string, string]] : []),
    [
      'Jogadores',
      game.players.min === game.players.max
        ? String(players)
        : `${players} (de ${game.players.min} a ${game.players.max})`,
    ],
    ...game.options.map((o): [string, string] => {
      const value = options?.[o.id] ?? o.default ?? choiceValue(o.choices[0]!);
      const choice = o.choices.find((c) => choiceValue(c) === value);
      return [o.label, choice ? choiceLabel(choice) : value];
    }),
    ['Peças na mesa', String(pieces)],
    [
      'Regras',
      rules.length
        ? rules.map((r) => (r.startsWith('data:') ? 'embutidas' : r)).join(', ')
        : 'nenhuma (os jogadores aplicam)',
    ],
    ['Formato', m.format],
  ];
  return (
    <dl className="bq-game-details" aria-label="Info do jogo carregado">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
