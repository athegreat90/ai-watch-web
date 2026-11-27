import { compose, docker, image, imageExists, writeRunFiles } from './support/stack';

/** Writes a fresh token, builds the image if there is none, and starts the server and the web image. */
export default function globalSetup(): void {
  if (process.env['E2E_NO_STACK'] === '1') return;
  writeRunFiles();
  if (!imageExists()) {
    const build = docker(['build', '-f', 'docker/Dockerfile', '-t', image, '.'], 900_000);
    if (build.status !== 0) throw new Error(`Could not build ${image}:\n${build.stderr}`);
  }
  // Start from nothing, so no old container keeps an old token.
  compose(['down', '-v', '--remove-orphans']);
  const up = compose(['up', '-d', '--wait', '--wait-timeout', '120'], 360_000);
  if (up.status !== 0) throw new Error(`The test stack did not start:\n${up.stdout}\n${up.stderr}`);
}
