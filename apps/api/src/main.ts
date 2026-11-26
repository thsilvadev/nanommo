import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { installMinuteLogFiles } from './logging/minute-log-files';

async function bootstrap() {
  // One log file per UTC minute, last 30 minutes kept (see DEBUGGING.md). Off unless LOG_MINUTE_DIR is set.
  if (process.env.LOG_MINUTE_DIR) installMinuteLogFiles({ dir: process.env.LOG_MINUTE_DIR });

  const app = await NestFactory.create(AppModule);

  // Trust only the first proxy (Caddy) - enables Express to read X-Forwarded-For header for rate limiting
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', 1);

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`Application listening on port ${port}`);
}

bootstrap();
