import { query } from '../db';
import { deleteSessionState } from '../redis';

export async function deleteSessionWithArtifacts(sessionId: string) {
  query('DELETE FROM drawings WHERE session_id = $1', [sessionId]);
  query('DELETE FROM session_participants WHERE session_id = $1', [sessionId]);
  query('DELETE FROM sessions WHERE id = $1', [sessionId]);
  await deleteSessionState(sessionId);
}
