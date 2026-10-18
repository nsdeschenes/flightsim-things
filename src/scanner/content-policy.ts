type ContentPolicy = Readonly<{
  aircraft: boolean;
  airports: boolean;
  liveries: boolean;
}>;

function contentPolicy(contentType?: string | null): ContentPolicy {
  return {
    aircraft: contentType === 'AIRCRAFT',
    airports: contentType === 'SCENERY',
    liveries: contentType === 'AIRCRAFT' || contentType === 'LIVERY',
  };
}

export default contentPolicy;
