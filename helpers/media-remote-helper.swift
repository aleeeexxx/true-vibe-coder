import AVFoundation
import CoreAudio
import Foundation
import MediaPlayer

final class StandardOutput {
  private let lock = NSLock()

  func write(_ object: [String: Any]) {
    guard
      JSONSerialization.isValidJSONObject(object),
      let data = try? JSONSerialization.data(withJSONObject: object),
      let line = String(data: data, encoding: .utf8)
    else {
      return
    }

    lock.lock()
    FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    lock.unlock()
  }
}

private let output = StandardOutput()

private func audioDeviceIds() -> [AudioDeviceID] {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioHardwarePropertyDevices,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var dataSize: UInt32 = 0

  guard
    AudioObjectGetPropertyDataSize(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      0,
      nil,
      &dataSize
    ) == noErr,
    dataSize > 0
  else {
    return []
  }

  var devices = [AudioDeviceID](
    repeating: 0,
    count: Int(dataSize) / MemoryLayout<AudioDeviceID>.size
  )
  guard
    AudioObjectGetPropertyData(
      AudioObjectID(kAudioObjectSystemObject),
      &address,
      0,
      nil,
      &dataSize,
      &devices
    ) == noErr
  else {
    return []
  }

  return devices
}

private func audioDeviceUInt32Property(
  _ device: AudioDeviceID,
  selector: AudioObjectPropertySelector
) -> UInt32? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: UInt32 = 0
  var dataSize = UInt32(MemoryLayout<UInt32>.size)

  guard
    AudioObjectGetPropertyData(
      device,
      &address,
      0,
      nil,
      &dataSize,
      &value
    ) == noErr
  else {
    return nil
  }

  return value
}

private func audioDeviceStringProperty(
  _ device: AudioDeviceID,
  selector: AudioObjectPropertySelector
) -> String? {
  var address = AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
  var value: Unmanaged<CFString>?
  var dataSize = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)

  guard
    AudioObjectGetPropertyData(
      device,
      &address,
      0,
      nil,
      &dataSize,
      &value
    ) == noErr
  else {
    return nil
  }

  return value?.takeUnretainedValue() as String?
}

private func audioDeviceHasOutput(_ device: AudioDeviceID) -> Bool {
  var address = AudioObjectPropertyAddress(
    mSelector: kAudioDevicePropertyStreams,
    mScope: kAudioDevicePropertyScopeOutput,
    mElement: kAudioObjectPropertyElementMain
  )
  var dataSize: UInt32 = 0

  return AudioObjectGetPropertyDataSize(
    device,
    &address,
    0,
    nil,
    &dataSize
  ) == noErr && dataSize >= UInt32(MemoryLayout<AudioStreamID>.size)
}

private func builtInOutputDevice() -> (uid: String, name: String)? {
  for device in audioDeviceIds() {
    guard
      audioDeviceHasOutput(device),
      audioDeviceUInt32Property(
        device,
        selector: kAudioDevicePropertyTransportType
      ) == kAudioDeviceTransportTypeBuiltIn,
      let uid = audioDeviceStringProperty(
        device,
        selector: kAudioDevicePropertyDeviceUID
      ),
      !uid.isEmpty
    else {
      continue
    }

    let name =
      audioDeviceStringProperty(
        device,
        selector: kAudioObjectPropertyName
      ) ?? "Built-in output"
    return (uid, name)
  }

  return nil
}

private func appendLittleEndian<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
  var littleEndianValue = value.littleEndian
  withUnsafeBytes(of: &littleEndianValue) { bytes in
    data.append(contentsOf: bytes)
  }
}

private func createSilentWaveFile() throws -> URL {
  let sampleRate: UInt32 = 48_000
  let channelCount: UInt16 = 2
  let bitsPerSample: UInt16 = 16
  let seconds: UInt32 = 1
  let bytesPerSample = UInt32(bitsPerSample / 8)
  let dataSize = sampleRate * UInt32(channelCount) * bytesPerSample * seconds
  let byteRate = sampleRate * UInt32(channelCount) * bytesPerSample
  let blockAlign = channelCount * (bitsPerSample / 8)

  var wave = Data()
  wave.append(contentsOf: Array("RIFF".utf8))
  appendLittleEndian(UInt32(36) + dataSize, to: &wave)
  wave.append(contentsOf: Array("WAVE".utf8))
  wave.append(contentsOf: Array("fmt ".utf8))
  appendLittleEndian(UInt32(16), to: &wave)
  appendLittleEndian(UInt16(1), to: &wave)
  appendLittleEndian(channelCount, to: &wave)
  appendLittleEndian(sampleRate, to: &wave)
  appendLittleEndian(byteRate, to: &wave)
  appendLittleEndian(blockAlign, to: &wave)
  appendLittleEndian(bitsPerSample, to: &wave)
  wave.append(contentsOf: Array("data".utf8))
  appendLittleEndian(dataSize, to: &wave)
  wave.append(Data(count: Int(dataSize)))

  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent("true-vibe-coder-media-remote-silence.wav")
  try wave.write(to: url, options: .atomic)
  return url
}

final class MediaRemoteSession {
  private let player = AVQueuePlayer()
  private var looper: AVPlayerLooper?
  private var commandTokens: [Any] = []
  private var keepAliveTimer: Timer?
  private var lastReportedActiveState: Bool?
  private var silentOutputName = "Default output"

  func start() throws {
    let silentFile = try createSilentWaveFile()
    let item = AVPlayerItem(url: silentFile)
    looper = AVPlayerLooper(player: player, templateItem: item)
    if let builtInOutput = builtInOutputDevice() {
      player.audioOutputDeviceUniqueID = builtInOutput.uid
      silentOutputName = builtInOutput.name
    }
    player.isMuted = true
    player.play()

    let infoCenter = MPNowPlayingInfoCenter.default()
    infoCenter.nowPlayingInfo = [
      MPMediaItemPropertyTitle: "Headset Shortcut",
      MPMediaItemPropertyArtist: "True Vibe Coder",
      MPMediaItemPropertyPlaybackDuration: 86_400,
      MPNowPlayingInfoPropertyElapsedPlaybackTime: 0,
      MPNowPlayingInfoPropertyPlaybackRate: 1,
      MPNowPlayingInfoPropertyDefaultPlaybackRate: 1,
      MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
    ]
    infoCenter.playbackState = .playing

    registerCommands(on: MPRemoteCommandCenter.shared())

    keepAliveTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      guard let self else {
        return
      }
      if self.player.rate == 0 {
        self.player.play()
      }
      MPNowPlayingInfoCenter.default().playbackState = .playing

      let isActive = self.player.timeControlStatus == .playing
      if self.lastReportedActiveState != isActive {
        self.lastReportedActiveState = isActive
        output.write([
          "type": "media-remote-status",
          "active": isActive,
          "silentOutput": self.silentOutputName,
        ])
      }
    }
    RunLoop.current.add(keepAliveTimer!, forMode: .common)
  }

  private func registerCommands(on center: MPRemoteCommandCenter) {
    let commands: [(String, MPRemoteCommand)] = [
      ("toggle", center.togglePlayPauseCommand),
      ("play", center.playCommand),
      ("pause", center.pauseCommand),
    ]

    for (name, command) in commands {
      command.isEnabled = true
      let token = command.addTarget { [weak self] _ in
        guard let self else {
          return .commandFailed
        }

        output.write([
          "type": "media-remote-input",
          "command": name,
          "timestamp": Date().timeIntervalSince1970,
        ])
        self.player.play()
        MPNowPlayingInfoCenter.default().playbackState = .playing
        return .success
      }
      commandTokens.append(token)
    }

    center.stopCommand.isEnabled = false
    center.nextTrackCommand.isEnabled = false
    center.previousTrackCommand.isEnabled = false
  }
}

let mediaRemoteSession = MediaRemoteSession()

do {
  try mediaRemoteSession.start()
  output.write(["type": "ready", "mode": "media-remote"])
  RunLoop.current.run()
} catch {
  output.write([
    "type": "error",
    "message": "Unable to start media remote session: \(error)",
  ])
  exit(1)
}
