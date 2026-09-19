/**
 * Class name joiner. `clsx` is a dependency of the workspace; this keeps the
 * import path short and gives one place to add anything conditional later.
 */
import clsx from 'clsx';

export function cn(...inputs) {
  return clsx(inputs);
}

export default cn;
