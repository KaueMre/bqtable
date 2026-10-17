import { Link } from 'react-router';
import { BindingDemo } from './BindingDemo';
import { DadosDemo } from './DadosDemo';
import { ManagerDemo } from './ManagerDemo';
import { MesaDemo } from './MesaDemo';
import { PieceDemo } from './PieceDemo';
import { TabuleiroDemo } from './TabuleiroDemo';
import { ZonasDemo } from './ZonasDemo';
import './sandbox.css';

/** Testes visuais de cada fase do plano (PlanoReact.md, seção 7). */
export function SandboxPage() {
  return (
    <>
      <h1>Sandbox</h1>
      <section>
        <h2>Fase 6 · Dados (React Query)</h2>
        <DadosDemo />
      </section>
      <section>
        <h2>Fase 5 · Tabuleiro como componente</h2>
        <TabuleiroDemo />
      </section>
      <section>
        <h2>Fase 5 · Mesas (zonas)</h2>
        <ZonasDemo />
      </section>
      <section>
        <h2>Fase 4 · Mesa (Konva)</h2>
        <p>
          <Link to="/sandbox/carga">Teste de carga →</Link>
        </p>
        <MesaDemo />
      </section>
      <section>
        <h2>Fase 3 · Ligação com React</h2>
        <BindingDemo />
      </section>
      <section>
        <h2>Fase 2 · Gestor e eventos</h2>
        <ManagerDemo />
      </section>
      <section>
        <h2>Fase 1 · Peça</h2>
        <PieceDemo />
      </section>
    </>
  );
}
