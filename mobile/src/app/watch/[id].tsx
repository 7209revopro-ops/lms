import { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { useVideoPlayer, VideoView, type VideoPlayer } from 'expo-video'
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
/* The player is a native object driven by commands (outside the component). */
function resume(player: VideoPlayer): void {
  player.play()
}

export default function Watch() {
  const { id, recording } = useLocalSearchParams<{ id: string; recording?: string }>()
  const { t } = useTranslation()
  const { colors } = useTheme()
  useContentGuard()
  const watch = useWatchAccess(id)
  const wantsRecording = recording === '1'
  const src = wantsRecording ? watch.data?.recordingUrl : (watch.data?.status === 'live' ? watch.data?.playbackUrl : undefined)

  const player = useVideoPlayer(src ?? null, p => { p.play() })
  /* The live stream can start while the screen is open. useVideoPlayer itself
     swaps in the new address (replaceAsync) when src changes — loading it here
     too would fetch every stream twice — so this only presses play. */
  useEffect(() => {
    if (src) resume(player)
  }, [src, player])

  if (watch.isLoading) return <Loading />
  /* Only when there is nothing to show: one failed 20-s poll must not unmount
     a stream that is playing (the next poll recovers). */
  if (watch.error && !watch.data) return <Failed error={watch.error} onRetry={() => void watch.refetch()} />

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
