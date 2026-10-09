import { Capacitor } from '@capacitor/core'

export function getNativePlatform(): 'ios' | 'android' | 'web' {
  if (!Capacitor.isNativePlatform()) return 'web'
  return Capacitor.getPlatform() as 'ios' | 'android'
}

export function isNativeIOS(): boolean {
  return getNativePlatform() === 'ios'
}

export function isNativeAndroid(): boolean {
  return getNativePlatform() === 'android'
}
