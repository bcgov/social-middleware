import { UserSchema } from '../schemas/user.schema';

describe('User schema', () => {
  it('leaves non_key_player_caregiver unchanged', () => {
    const path = UserSchema.path('non_key_player_caregiver');
    expect(path.options.default).toBeNull();
  });
});
