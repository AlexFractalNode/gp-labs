/**
 * The numbers that occur in the texts `scenario.<id>.{title, short, see, watch, next}` (DE and EN), normalised:
 * decimal point, '-' for the minus sign. tests/core/scenarioNumbers.test.ts checks that the texts contain exactly
 * these numbers; the claims tests in this folder prove each of them against the GP core (`claim`).
 */
export const CLAIMED: Record<string, readonly string[]> = {
  p1: ['9', '0', '1', '0.800', '0.447', '0.671', '0.8', '0.485', '0.840', '3'],
  p2: ['11', '-1', '0.5', '3', '0', '1.000', '1.005', '0.099'],
  p3: ['12', '43', '500', '1', '-1553.4', '45', '0.001', '-868.3', '47', '0.01', '5', '-531.9', '0.10', '1.62', '0.41', '-294.5'],
  k1: ['8', '0.2', '61', '0.5', '4'],
  k2: ['13.4', '0.5', '2', '0', '6', '1', '3', '0.88'],
  k3: ['8.5', '2.5', '2', '-2'],
  d1: ['15', '5', '0.392', '324.65', '2', '31', '28'],
  d2: ['14', '15', '0.421', '305.75'],
  d3: ['17', '0.369', '29', '31', '2'],
}
