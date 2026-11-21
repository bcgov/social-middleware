import { RelationshipToPrimary } from '../../household/enums/relationship-to-primary.enum';
import {
  ApplicationFormType,
  getScreeningFormRecipe,
} from '../enums/application-form-types.enum';

describe('getScreeningFormRecipe', () => {
  it('gives a relief provider About Me and both consent forms', () => {
    expect(
      getScreeningFormRecipe(RelationshipToPrimary.ReliefProvider),
    ).toEqual([
      ApplicationFormType.ABOUTME,
      ApplicationFormType.DISCLOSURECONSENT,
      ApplicationFormType.PCCCONSENT,
    ]);
  });

  it('keeps the spouse recipe unchanged', () => {
    expect(getScreeningFormRecipe(RelationshipToPrimary.Spouse)).toEqual([
      ApplicationFormType.ABOUTSPOUSE,
      ApplicationFormType.DISCLOSURECONSENT,
      ApplicationFormType.PCCCONSENT,
    ]);
  });

  it('gives other members the two consent forms only', () => {
    expect(getScreeningFormRecipe(RelationshipToPrimary.Other)).toEqual([
      ApplicationFormType.DISCLOSURECONSENT,
      ApplicationFormType.PCCCONSENT,
    ]);
  });
});
