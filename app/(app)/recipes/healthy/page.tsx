import { redirect } from 'next/navigation'

// The Healthy Recipes browse experience now lives in the main Discover tab.
// Old links and bookmarks to /recipes/healthy are sent there transparently.
export default function HealthyRecipesPage() {
  redirect('/recipes')
}
