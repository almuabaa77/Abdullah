import('./server.js').catch((error) => {
  console.error(error instanceof Error ? error.message : 'Could not start Halaqat')
  process.exitCode = 1
})
