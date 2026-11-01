/**
 * What trusting a repository allows (ADR 0036, 0041, 0090): one grant covers trace probes and
 * dependency installs. Every trust prompt shows this sentence.
 */
export const trustGrantWording =
  'Trusting lets beuve run this repository’s tests and install its dependencies, including their install scripts, on this machine with your access to files and network. It covers every commit you review here, pull requests from other people included. Only continue for code you trust.';
