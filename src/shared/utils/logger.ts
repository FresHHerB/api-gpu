import winston from 'winston';
import { join } from 'path';

// Determinar diretório de logs
const logsDir = process.env.LOGS_DIR || './logs';

// Formato personalizado
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Logger para console (development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}] ${message}`;

    // Adicionar metadata se existir
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta, null, 2)}`;
    }

    return msg;
  })
);

// Criar logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports: [
    // Console (sempre ativo)
    new winston.transports.Console({
      format: consoleFormat
    }),

    // Arquivo combined (info+)
    new winston.transports.File({
      filename: join(logsDir, 'combined.log'),
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    }),

    // Arquivo de erros
    new winston.transports.File({
      filename: join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5
    })
  ],

  // Tratamento de exceções
  exceptionHandlers: [
    new winston.transports.File({
      filename: join(logsDir, 'exceptions.log')
    })
  ],

  // Tratamento de rejeições
  rejectionHandlers: [
    new winston.transports.File({
      filename: join(logsDir, 'rejections.log')
    })
  ]
});

// Em produção, não logar debug
if (process.env.NODE_ENV === 'production') {
  logger.level = 'info';
}

// Exportar como default também
export default logger;
