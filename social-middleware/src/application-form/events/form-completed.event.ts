export class FormCompletedEvent {
  constructor(
    public readonly applicationFormId: string,
    public readonly applicationPackageId: string,
    public readonly formType: string,
  ) {}
}
