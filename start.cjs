import('./server.mjs')
  .then(({ startServer }) => startServer())
  .catch(error => {
    console.error('[waslah] Startup failed:', error);
    process.exitCode = 1;
  });
