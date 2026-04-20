import { Readable, Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { Sha256PassThrough } from './hashing-stream';

function sha256Of(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

function drain(readable: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readable.on('data', (c: Buffer) => chunks.push(c));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

describe('Sha256PassThrough', () => {
  it('hasheia um payload unico e passa os bytes inalterados', async () => {
    const payload = Buffer.from('metricId;dateTime;value\n42;10/01/2024 00:00;5\n');
    const hasher = new Sha256PassThrough();

    const piped = Readable.from([payload]).pipe(hasher);
    const out = await drain(piped as unknown as Readable);

    expect(out.equals(payload)).toBe(true);
    expect(hasher.digestHex()).toBe(sha256Of(payload));
  });

  it('hasheia corretamente quando o input chega em multiplos chunks', async () => {
    const a = Buffer.from('primeira-parte-');
    const b = Buffer.from('segunda-parte-');
    const c = Buffer.from('terceira-parte');
    const hasher = new Sha256PassThrough();

    const piped = Readable.from([a, b, c]).pipe(hasher);
    const out = await drain(piped as unknown as Readable);

    expect(out.toString()).toBe('primeira-parte-segunda-parte-terceira-parte');
    expect(hasher.digestHex()).toBe(sha256Of(Buffer.concat([a, b, c])));
  });

  it('produz hashes distintos para conteudos diferentes', async () => {
    const h1 = new Sha256PassThrough();
    const h2 = new Sha256PassThrough();
    const sink = () =>
      new Writable({ write: (_c, _e, cb) => cb() });

    await new Promise<void>((resolve, reject) => {
      Readable.from([Buffer.from('conteudo A')])
        .pipe(h1)
        .pipe(sink())
        .on('finish', resolve)
        .on('error', reject);
    });
    await new Promise<void>((resolve, reject) => {
      Readable.from([Buffer.from('conteudo B')])
        .pipe(h2)
        .pipe(sink())
        .on('finish', resolve)
        .on('error', reject);
    });

    expect(h1.digestHex()).not.toBe(h2.digestHex());
  });
});
