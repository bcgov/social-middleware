// need equivalent for
// application/submit to have FF update the forms data
/*
  @Put('submit')
  @ApiOperation({ summary: 'Submit application and update form data' })
  @ApiResponse({
    status: 200,
    description: 'Application data successfully updated',
  })
  @ApiResponse({ status: 404, description: 'Token or application not found' })
  @ApiResponse({
    status: 500,
    description: 'Server error during application submission',
  })
  async submitApplication(
    @Body(new ValidationPipe({ whitelist: true, transform: true }))
    dto: SubmitApplicationDto,
  ) {
    return this.applicationService.submitApplication(dto);
*/
