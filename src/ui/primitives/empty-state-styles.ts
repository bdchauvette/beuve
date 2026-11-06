import { css } from 'lit';

/**
 * Nothing to show (ADR 0115). `.empty` is a muted line in a list or panel; its padding is the
 * container's. `.empty-screen` fills a whole view with a centered column (an `h1`, muted `p`s, then
 * content) that is `--empty-screen-width` wide (620px unless set).
 */
export const emptyStateStyles = css`
  .empty {
    margin: 0;
    color: var(--beuve-text-muted);
  }

  .empty-screen {
    position: relative;
    display: flex;
    justify-content: center;
    overflow: auto;
    padding: 10vh var(--beuve-space-6) var(--beuve-space-6);
    background: var(--beuve-bg);
    outline: none;
  }

  .empty-screen > div {
    inline-size: min(var(--empty-screen-width, 620px), 100%);
  }

  .empty-screen h1 {
    margin: 0 0 var(--beuve-space-1);
    font: var(--beuve-font-title);
  }

  .empty-screen p {
    margin: 0 0 var(--beuve-space-4);
    color: var(--beuve-text-muted);
  }
`;
