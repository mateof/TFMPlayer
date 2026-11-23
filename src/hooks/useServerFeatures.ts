import { useQuery } from '@tanstack/react-query';
import { serverCapabilities } from '@/services/server/capabilities';
import { apiClient } from '@/services/api/client';
import { queryClient } from '@/services/query/queryClient';

const QUERY_KEY = ['server', 'capabilities'] as const;

// Another server configured: ask again
apiClient.onReset(() => queryClient.removeQueries({ queryKey: QUERY_KEY }));

const NONE: ReadonlySet<string> = new Set();

/**
 * Optional features of the connected server (asked once per session). Until
 * the answer arrives the set is empty, so screens start with the old
 * behaviour and add options as soon as they are known.
 */
export function useServerFeatures(): { features: ReadonlySet<string>; loaded: boolean } {
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => serverCapabilities.get(),
    // The service remembers a real answer for the session; a failed attempt
    // (offline) comes back empty, so look again after a while
    staleTime: 5 * 60_000,
    retry: false
  });
  return { features: query.data?.features ?? NONE, loaded: query.isSuccess };
}
