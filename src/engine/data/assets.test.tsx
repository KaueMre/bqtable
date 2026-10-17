import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { isImageUrl, loadImage, preloadImages, registerImageGenerator, useImage } from './assets';

describe('imagens geradas', () => {
  it('URL com esquema registrado vira imagem na hora, sem rede', async () => {
    const generate = vi.fn(() => document.createElement('canvas'));
    registerImageGenerator('teste', generate);
    expect(isImageUrl('teste:a/1')).toBe(true);
    await preloadImages(['teste:a/1', 'teste:a/1']);
    expect(generate).toHaveBeenCalledTimes(1); // cache por URL
    expect(generate).toHaveBeenCalledWith('a/1');
    const { result } = renderHook(() => useImage('teste:a/1'));
    expect(result.current).toBeInstanceOf(HTMLCanvasElement);
  });

  it('gerador que não sabe desenhar vira falha (placeholder), não erro', async () => {
    registerImageGenerator('vazio', () => null);
    expect(loadImage('vazio:x').getStatus()).toBe('failed');
    await expect(preloadImages(['vazio:x'])).resolves.toBeUndefined();
    const { result } = renderHook(() => useImage('vazio:x'));
    expect(result.current).toBeUndefined();
  });

  it('texto comum não é imagem', () => {
    expect(isImageUrl('verso')).toBe(false);
    expect(isImageUrl('desconhecido:x')).toBe(false);
    expect(isImageUrl('/arte/carta.png')).toBe(true);
  });
});

describe('preloadImages', () => {
  it('imagem que não responde não segura o jogo', async () => {
    const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    // simula uma URL pendurada: nunca dispara load nem error
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      set() {},
      get: () => '',
    });
    try {
      const start = Date.now();
      await preloadImages(['/lenta.png'], { timeoutMs: 50 });
      expect(Date.now() - start).toBeLessThan(1000);
      expect(loadImage('/lenta.png').getStatus()).toBe('loading');
    } finally {
      Object.defineProperty(HTMLImageElement.prototype, 'src', original);
    }
  });
});
