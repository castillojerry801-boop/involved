import { redirect } from 'next/navigation'

export default function RecipesRedirectPage({
  searchParams,
}: {
  searchParams: { tab?: string }
}) {
  const tab = searchParams.tab
  if (tab) {
    redirect(`/recipes?tab=${tab}`)
  }
  redirect('/recipes')
}
