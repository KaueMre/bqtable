import Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { createManager, nextRandom, type Manager } from '@/engine/core';
import { ManagerProvider } from '@/engine/react';
import { Table } from '@/engine/render/konva';
import { CARD, cardFace } from './faces';
import './sandbox.css';

const COUNTS = [150, 300, 600];
const VARIANTS = 8;

function createLoadManager(count: number): Manager {
  const m = createManager({ seed: 5 });
  m.registerKind({ kind: 'camada', defaults: { size: CARD } });
  let rng = 12345;
  const random = () => {
    const [v, next] = nextRandom(rng);
    rng = next;
    return v;
  };
  for (let i = 0; i < count; i++) {
    const v = i % VARIANTS;
    m.dispatch({
      type: 'createPiece',
      piece: {
        id: `c${i}`,
        kind: 'camada',
        faces: { default: cardFace({ label: `v${v}`, hue: v * 45, variant: 'transparent' }) },
        transform: {
          x: 80 + random() * 1200,
          y: 100 + random() * 700,
          rotation: Math.round(random() * 8) * 45,
          z: i,
        },
      },
    });
  }
  m.clearHistory();
  return m;
}

/** Quadros por segundo medidos com requestAnimationFrame, e o pior valor desde o último reset. */
function useFps() {
  const [fps, setFps] = useState({ now: 0, min: Infinity });
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t) {
      frames++;
      if (t - last >= 500) {
        const now = Math.round((frames * 1000) / (t - last));
        setFps((f) => ({ now, min: Math.min(f.min, now) }));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return [fps, () => setFps((f) => ({ ...f, min: Infinity }))] as const;
}

/**
 * Teste de carga da fase 4 (PlanoReact.md, 5.2): muitas imagens transparentes sobrepostas.
 * "Animar" gira todas as peças direto no Konva, sem passar pelo Gestor: mede só o desenho.
 */
export function LoadTestPage() {
  const [count, setCount] = useState(COUNTS[0]!);
  const [manager, setManager] = useState(() => createLoadManager(count));
  const [animating, setAnimating] = useState(false);
  const stageRef = useRef<Konva.Stage>(null);
  const [fps, resetMin] = useFps();

  useEffect(() => {
    const stage = stageRef.current;
    if (!animating || !stage) return;
    const nodes = stage.find('.piece');
    const anim = new Konva.Animation((frame) => {
      const step = ((frame?.timeDiff ?? 16) * 90) / 1000; // 90°/s
      for (const node of nodes) node.rotate(step);
    }, nodes[0]?.getLayer());
    anim.start();
    return () => {
      anim.stop();
      // volta cada nó para a rotação do estado
      const pieces = manager.getState().pieces;
      for (const node of nodes) node.rotation(pieces[node.id()]?.transform.rotation ?? 0);
    };
  }, [animating, manager]);

  const changeCount = (n: number) => {
    setAnimating(false);
    setCount(n);
    setManager(createLoadManager(n));
    resetMin();
  };

  return (
    <>
      <h1>Teste de carga · Konva</h1>
      <p className="demo-hint">
        <Link to="/sandbox">← Sandbox</Link> · Arraste e gire peças (ou ligue "Animar") e observe o
        FPS. Meta: 60 fps no desktop com 150 peças.
      </p>
      <div className="demo-buttons">
        {COUNTS.map((n) => (
          <button key={n} onClick={() => changeCount(n)} disabled={n === count}>
            {n} peças
          </button>
        ))}
        <button onClick={() => setAnimating((a) => !a)}>
          {animating ? 'Parar' : 'Animar todas'}
        </button>
        <button onClick={resetMin}>Zerar mínimo</button>
        <strong className="demo-fps" aria-live="off">
          {fps.now} fps · mínimo {Number.isFinite(fps.min) ? fps.min : '–'}
        </strong>
      </div>
      <div className="demo-stage demo-stage--large">
        <ManagerProvider manager={manager}>
          <Table key={count} stageRef={stageRef} />
        </ManagerProvider>
      </div>
    </>
  );
}
