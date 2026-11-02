class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);
const validation = (message) => new HttpError(400, 'validation_failed', message);
const conflict = (message) => new HttpError(409, 'conflict', message);

function sendError(res, status, code, message) {
  res.status(status).json({ error: { code, message } });
}

function notFoundHandler(req, res) {
  sendError(res, 404, 'not_found', `No route for ${req.method} ${req.path}`);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'Request body is not valid JSON');
  }
  if (err instanceof HttpError) {
    return sendError(res, err.status, err.code, err.message);
  }
  console.error(err);
  return sendError(res, 500, 'internal', 'Internal server error');
}

module.exports = { HttpError, notFound, validation, conflict, notFoundHandler, errorHandler };
