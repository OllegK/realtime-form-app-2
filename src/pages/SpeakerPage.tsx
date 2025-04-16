import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RealtimeClient } from '@openai/realtime-api-beta';
import { Button } from '../components/button/Button';
import { Toggle } from '../components/toggle/Toggle';
import { instructions } from '../utils/prompt.js';
import { WavRecorder } from '../lib/wavtools/index.js';
import './Styles.scss';
import { io, Socket } from 'socket.io-client';

const JSON_TEMPLATE = {
  name: '',
  age: '',
  type: '',
  subType: '',
  status: '',
  freeText: ''
}

export const OPENAI_API_KEY = process.env.REACT_APP_OPENAI_API_KEY;

export const DEFAULT_REALTIME_MODEL = "gpt-4o-realtime-preview-2024-12-17";
export const DEFAULT_REALTIME_VOICE = "coral";
interface RealtimeEvent {
  time: string;
  source: 'client' | 'server';
  event: any;
  count?: number;
}

export function SpeakerPage() {
  const [realtimeEvents, setRealtimeEvents] = useState<RealtimeEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [canPushToTalk, setCanPushToTalk] = useState(true);
  const [transcripts, setTranscripts] = useState<{ transcript: string; language: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [json, setJson] = useState(JSON_TEMPLATE);

  const wavRecorderRef = useRef<WavRecorder>(
    new WavRecorder({ sampleRate: 24000 })
  );

  const socketRef = useRef<Socket | null>(null);

  const clientRef = useRef(new RealtimeClient({
    apiKey: OPENAI_API_KEY,
    dangerouslyAllowAPIKeyInBrowser: true,
  }));

  // Function to connect to the conversation and set up real-time clients
  const connectConversation = useCallback(async () => {
    try {
      setIsLoading(true);
      const wavRecorder = wavRecorderRef.current;
      await wavRecorder.begin();
      await connectAndSetupClients();
      setIsConnected(true);
    } catch (error) {
      console.error('Error connecting to conversation:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const disconnectConversation = useCallback(async () => {
    try {
      setIsConnected(false);
      setIsRecording(false);
      const wavRecorder = wavRecorderRef.current;
      await disconnectClients();
      await wavRecorder.end();
    } catch (error) {
      console.error('Error disconnecting from conversation:', error);
    }
  }, []);

  // Function to connect and set up all clients
  const connectAndSetupClients = async () => {
    const client = clientRef.current;
    await client.realtime.connect({ model: DEFAULT_REALTIME_MODEL });
    await client.updateSession({ voice: DEFAULT_REALTIME_VOICE });
  };

  // Function to disconnect all clients
  const disconnectClients = async () => clientRef.current.disconnect();

  const startRecording = async () => {
    setIsRecording(true);
    const wavRecorder = wavRecorderRef.current;

    await wavRecorder.record((data) => {
      // Send mic PCM to all clients
      clientRef.current.appendInputAudio(data.mono);
    });
  };

  const stopRecording = async () => {
    setIsRecording(false);
    const wavRecorder = wavRecorderRef.current;

    if (wavRecorder.getStatus() === 'recording') {
      await wavRecorder.pause();
    }

    const client = clientRef.current;
    client.updateSession({
      instructions: instructions.replace('{PLACEHOLDER}', JSON.stringify(json)),
    });
    
    client.createResponse();
  };

  const changeTurnEndType = async (value: string) => {
    const wavRecorder = wavRecorderRef.current;

    if (value === 'none') {
      // If 'none' is selected, pause the recorder and disable turn detection for all clients
      await wavRecorder.pause();
      clientRef.current.updateSession({ turn_detection: null });
      // Allow manual push-to-talk
      setCanPushToTalk(true);
    } else {
      // If 'server_vad' is selected, enable server-based voice activity detection for all clients
      clientRef.current.updateSession({ turn_detection: { type: 'server_vad' } });
      await wavRecorder.record((data) => {
          clientRef.current.appendInputAudio(data.mono);
      });
      setCanPushToTalk(false);
    }
  };

  useEffect(() => {
    socketRef.current = io('http://localhost:3001'); 
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
      const client = clientRef.current;
      client.updateSession({
        instructions: instructions.replace('{PLACEHOLDER}', JSON.stringify(JSON_TEMPLATE)),
        input_audio_transcription: { model: 'whisper-1' },
      });

      client.on('realtime.event', (ev: RealtimeEvent) => handleRealtimeEvent(ev, 'en'));
      client.on('error', (err: any) => console.error(`en client error:`, err));

      client.on('conversation.updated', ({ delta }: any) => {
        console.log(`client.on conversation.updated`, delta);
        if (delta?.audio && delta.audio.byteLength > 0) {
          console.log(`Emitting audio for en:`, delta.audio);
          socketRef.current?.emit(`mirrorAudio:en`, delta.audio);
        }
      });
    // Cleanup function to reset all clients when the component unmounts or dependencies change
    return () => { client.reset() }
  }, []); 

  const handleRealtimeEvent = (ev: RealtimeEvent, languageCode: string) => {
    console.log('>>>> handleRealtimeEvent..... ev.event.type', ev.event.type);
    if (ev.event.type == "response.audio_transcript.done") {
      console.log('>>>> handleRealtimeEvent', ev.event.transcript);
      // Update the transcripts state by adding the new transcript with language code
      setJson(ev.event.transcript);
      setTranscripts((prev) => [{ transcript: ev.event.transcript, language: languageCode }, ...prev]);
    }

    // why do I need it?
    setRealtimeEvents((prev) => {
      const lastEvent = prev[prev.length - 1];
      if (lastEvent?.event.type === ev.event.type) {
        lastEvent.count = (lastEvent.count || 0) + 1;
        return [...prev.slice(0, -1), lastEvent];
      }
      return [...prev, ev];
    });
  };

  return (
    <div className="speaker-page">
      <div className="card">
        <div className="card-content">
          <p>Connect to send English audio</p>
        </div>
        <div className="toggle-container">
          {isConnected && (
            <Toggle
              defaultValue={false}
              labels={['Manual', 'VAD']}
              values={['none', 'server_vad']}
              onChange={(_, value) => changeTurnEndType(value)}
            />
          )}
        </div>
        <div className="card-footer">
          {isConnected ? (
            <Button label="Disconnect" onClick={disconnectConversation} />
          ) : (
            <Button
              label={isLoading ? 'Connecting...' : 'Connect'}
              onClick={connectConversation}
              disabled={isLoading}
            />
          )}
          {isConnected && canPushToTalk && (
            <Button
              label={isRecording ? 'Stop Recording' : 'Start Recording'}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!isConnected}
            />
          )}
        </div>
      </div>
      <div className="transcript-list">
        <table>
          <tbody>
            {transcripts.map(({ transcript }, index) => (
              <tr key={index}>
                <td>
                  <div className="transcript-box">{transcript}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}