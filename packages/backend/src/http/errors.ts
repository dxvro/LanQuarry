import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

function body(code: string, message: string, details?: unknown): ErrorBody {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

export function errorHandler(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  if (error instanceof AppError) {
    void reply.status(error.statusCode).send(body(error.code, error.message, error.details));
    return;
  }
  if (error instanceof ZodError) {
    void reply.status(400).send(
      body(
        'VALIDATION_ERROR',
        'Die Anfrage enthält ungültige Daten.',
        error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      ),
    );
    return;
  }
  const fastifyError = error as Partial<FastifyError>;
  if (fastifyError.validation !== undefined || fastifyError.statusCode === 400) {
    void reply.status(400).send(body('VALIDATION_ERROR', 'Die Anfrage enthält ungültige Daten.'));
    return;
  }
  if (fastifyError.statusCode === 413) {
    void reply.status(413).send(body('PAYLOAD_TOO_LARGE', 'Die Anfrage ist zu groß.'));
    return;
  }
  if (fastifyError.statusCode === 415) {
    void reply.status(415).send(body('UNSUPPORTED_MEDIA_TYPE', 'Der Inhaltstyp der Anfrage wird nicht unterstützt.'));
    return;
  }
  request.log.error({ err: error }, 'Unerwarteter Fehler');
  void reply.status(500).send(body('INTERNAL_ERROR', 'Es ist ein interner Fehler aufgetreten.'));
}

export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  void reply
    .status(404)
    .send(body('NOT_FOUND', `Die Ressource ${request.method} ${request.url.split('?')[0] ?? ''} wurde nicht gefunden.`));
}
