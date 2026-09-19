import { useEffect, useState } from 'react';

/**
 * Debounce a value. Used for search inputs so typing does not fire a request
 * per keystroke - the API is paged and filtered server side, so an unthrottled
 * input would produce a request queue the user never asked for.
 */
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

export default useDebounced;
