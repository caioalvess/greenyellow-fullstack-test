/**
 * Aumenta o tipo do Multer.File pra acomodar o `sha256` que o
 * AzuriteStorageEngine preenche via pass-through hashing. O multer anexa
 * automaticamente ao objeto `file` todo campo que o _handleFile retornar
 * no callback info — essa declaracao so' torna visivel pro TypeScript.
 */
declare global {
  namespace Express {
    namespace Multer {
      interface File {
        sha256?: string;
      }
    }
  }
}
export {};
