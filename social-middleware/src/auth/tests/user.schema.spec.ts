import { UserSchema } from '../schemas/user.schema';

describe('User schema', () => {
  it('defaults household_contacts to an empty array', () => {
    const path = UserSchema.path('household_contacts');
    expect(path).toBeDefined();
    expect(path.options.default).toEqual([]);
  });

  it('leaves non_key_player_caregiver unchanged', () => {
    const path = UserSchema.path('non_key_player_caregiver');
    expect(path.options.default).toBeNull();
  });
});
