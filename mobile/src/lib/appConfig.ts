import { useQuery } from '@tanstack/react-query'
import { updateState, type AppConfig, type UpdateState } from '@shared'
import { apiGet } from './http'
import { appVersion } from './device'

/* GET /app/config (plan.md §13.4 B5): forced update and maintenance, decided
   by the server so they never need an app release. A failure to fetch it
   never blocks the app — a student offline at launch still gets in. */
export function useAppGate(): { gate: UpdateState | 'maintenance'; config?: AppConfig } {
  const { data } = useQuery({
    queryKey: ['app', 'config'],
    queryFn: () => apiGet<AppConfig>('/app/config'),
    staleTime: 5 * 60_000,
    retry: 1,
  })
  if (!data) return { gate: 'ok' }
  if (data.maintenance) return { gate: 'maintenance', config: data }
  return { gate: updateState(appVersion, data), config: data }
}
