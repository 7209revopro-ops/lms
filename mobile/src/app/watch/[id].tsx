import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useVideoPlayer, VideoView } from 'expo-video'
import { useTranslation } from 'react-i18next'
import { useWatchAccess } from '@/lib/api/classes'
import { Watermark, useContentGuard } from '@/components/protected'
import { Loading, Empty, Failed } from '@/components/states'
import { useTheme } from '@/theme'

/* An in-app class's stream, or any class's recording, in the native player.
   The address comes from GET /live-classes/:id/watch, which checks the
   student's enrolment on every poll — the app never holds a playable URL it
   was not just given. The watermark carries the student's email, as on the
   website, so a screen recording names its source, and the screen blocks
   capture where the OS allows it (plan.md §13.9). */
export default function Watch() {
  const { id, recording } = useLocalSearchParams<{ id: string; recording?: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  useContentGuard()
  const watch = useWatchAccess(id)
  const wantsRecording = recording === '1'
  const src = wantsRecording ? watch.data?.recordingUrl : (watch.data?.status === 'live' ? watch.data?.playbackUrl : undefined)

  const player = useVideoPlayer(src ?? null, p => { p.play() })
  /* The live stream can start (or end) while the screen is open: follow the
     address the poll hands back. */
  useEffect(() => {
    if (src) void player.replaceAsync(src).then(() => player.play()).catch(() => {})
  }, [src, player])

  if (watch.isLoading) return <Loading />
  if (watch.error) return <Failed error={watch.error} onRetry={() => void watch.refetch()} />

  return (
    <>
      <Stack.Screen options={{ title: watch.data?.title ?? '', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff' }} />
      <View style={{ flex: 1, backgroundColor: '#000', justifyContent: 'center' }}>
        {src ? (
          <View style={{ width: '100%', aspectRatio: 16 / 9 }}>
            <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain"
              fullscreenOptions={{ enable: true }} allowsPictureInPicture={false} />
            <Watermark />
          </View>
        ) : (
          <View style={{ padding: 24, backgroundColor: colors.bgPage, flex: 1 }}>
            <Empty
              title={wantsRecording ? t('watch.noRecording') : watch.data?.status === 'ended' ? t('watch.ended') : t('watch.notStarted')}
              body={wantsRecording ? t('watch.recordingSoon') : t('watch.autoStart')} />
          </View>
        )}
      </View>
    </>
  )
}
