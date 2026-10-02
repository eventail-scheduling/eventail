export const contractVersionHeader = "Eventail-Contract-Version";

/**
 * The version of the HTTP contract this build serves, raised by hand.
 *
 * CONTRIBUTING.md says when to raise it. Do not derive it from the release
 * version: before 1.0.0 a breaking change bumps the minor and after it the
 * major, so a derived number would fall from 7 to 1 the day 1.0.0 ships, and
 * a contract version that goes backwards is worse than none.
 */
export const contractVersion = 2;
