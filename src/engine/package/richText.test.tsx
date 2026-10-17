import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './PieceInfo';
import { collectKeywords, expandKeywordLinks, keywordRefs, type Keyword } from './richText';

const keywords: Record<string, Keyword> = {
  block: { title: 'Block', text: 'Até o próximo <kw ref="turno">turno</kw>, evita dano.' },
  turno: { title: 'Turno', text: 'A vez de um jogador. Ver <kw ref="vez">vez</kw>.' },
  vez: { title: 'Vez', text: 'Ver <kw ref="turno">turno</kw>.' }, // ciclo
  forte: { title: 'Forte', text: 'Mais dano.' },
};

describe('texto rico', () => {
  it('atalhos [[id]] e [[id|texto]] viram palavras-chave', () => {
    expect(expandKeywordLinks('Ganhe [[block]] e [[forte|força]].', keywords)).toBe(
      'Ganhe <kw ref="block">Block</kw> e <kw ref="forte">força</kw>.',
    );
    expect(keywordRefs('[[block]] <kw ref="forte">x</kw> [[block|de novo]]')).toEqual([
      'block',
      'forte',
    ]);
  });

  it('palavras-chave dentro de palavras-chave, em ordem, sem repetir e sem laço', () => {
    expect(collectKeywords('[[block]] e [[forte]]', keywords)).toEqual([
      'block',
      'forte',
      'turno',
      'vez',
    ]);
    expect(collectKeywords('[[block]]', keywords, 2)).toEqual(['block', 'turno']);
    expect(collectKeywords('[[nao-existe]]', keywords)).toEqual([]);
  });

  it('HTML limitado: tira scripts, eventos e estilos perigosos; resolve imagens do pacote', () => {
    const html =
      '<b>Forte</b> <i>sim</i><script>alert(1)</script><span onclick="x()" style="color: red; background: url(x)">vermelho</span>' +
      '<img src="icones/fogo.png" onerror="x()"><a href="https://x">link</a><kw ref="block">Block</kw>';
    const { container } = render(
      <RichText html={html} keywords={keywords} resolveAsset={(s) => `asset:${s}`} />,
    );
    expect(container.querySelector('b')).toHaveTextContent('Forte');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).not.toContain('alert');
    const span = container.querySelector('span:not(.bq-kw)')!;
    expect(span.getAttribute('onclick')).toBeNull();
    expect(span).toHaveStyle({ color: 'rgb(255, 0, 0)' });
    expect(span.getAttribute('style')).not.toContain('url');
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('asset:icones/fogo.png');
    expect(img.getAttribute('onerror')).toBeNull();
    expect(container.querySelector('a')).toBeNull(); // link vira só o texto
    expect(container).toHaveTextContent('link');
    expect(screen.getByText('Block')).toHaveClass('bq-kw');
  });
});
