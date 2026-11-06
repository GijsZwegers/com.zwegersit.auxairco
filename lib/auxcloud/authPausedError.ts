import { LoginFailureReason } from './errors';

export default class AuthPausedError extends Error {

  constructor(message: string, readonly reason: LoginFailureReason) {
    super(message);
  }

}
