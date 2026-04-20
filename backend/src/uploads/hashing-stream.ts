import { Transform, type TransformCallback } from 'node:stream';
import { createHash, type Hash } from 'node:crypto';

/**
 * Transform "pass-through" que calcula SHA-256 dos chunks enquanto eles
 * fluem. Uso tipico: `file.stream.pipe(hasher).pipe(destino)` — a stream
 * nao e' materializada, o hash fica pronto quando o pipe termina.
 *
 * Evita a armadilha de adicionar um listener `data` em uma stream que
 * tambem esta sendo `pipe`ada: isso duplica o consumo de dados e quebra
 * a backpressure do Node. Um Transform e' o ponto unico de consumo.
 */
export class Sha256PassThrough extends Transform {
  private readonly hash: Hash;

  constructor() {
    super();
    this.hash = createHash('sha256');
  }

  _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.hash.update(chunk);
    callback(null, chunk);
  }

  digestHex(): string {
    return this.hash.digest('hex');
  }
}
